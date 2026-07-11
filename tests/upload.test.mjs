// Upload endpoint regression tests — merge/prune/write-budget behavior.
// Run: node tests/upload.test.mjs   (no build step / package.json needed)
//
// Locks the 2026-07-07 audit batch B contract:
//   - each board key (scouts/gems/watchlist) is written AT MOST ONCE per upload
//     (merge+reconcile in one pass, not merge-write then prune-write)
//   - byte-identical board content skips the write entirely
//   - dd:live:* is deleted only when it exists (they TTL out on their own)
//   - per-ticker CDN purge preserves the ticker's case (uppercase URLs)
//   - the response reports kvWrites for dd-side budget alerting

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "se-upload-"));
const copy = join(tmp, "upload.mjs");
writeFileSync(copy, readFileSync(join(__dirname, "..", "functions", "api", "dd", "upload.js")));

// Workers globals the module expects: the CDN cache (purge path).
const purged = [];
globalThis.caches = {
  default: {
    delete: async (req) => { purged.push(typeof req === "string" ? req : req.url); return true; },
    match: async () => undefined,
    put: async () => {},
  },
};

const { onRequestPost } = await import(pathToFileURL(copy).href);

function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ops = { put: 0, delete: 0, get: 0, putKeys: [] };
  return {
    store, ops,
    async get(k) { ops.get++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { ops.put++; ops.putKeys.push(k); store.set(k, v); },
    async delete(k) { ops.delete++; store.delete(k); },
  };
}

function ctx(kv, body) {
  return {
    env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
    request: {
      url: "https://eye.example/api/dd/upload",
      headers: { get: k => (k === "Authorization" ? "Bearer s3cret" : null) },
      json: async () => body,
    },
    waitUntil: () => {},
  };
}

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

// ── 1. board keys written at most once; unchanged boards skip the write ───────
{
  const kv = mockKV({
    "dd:scouts": JSON.stringify([{ ticker: "OLD", score: 7.1 }]),
    "dd:gems":   JSON.stringify([{ ticker: "GEM", score: 7.5 }]),
  });
  const res = await onRequestPost(ctx(kv, {
    results: [],
    scouts: [{ ticker: "NEW", score: 8.0 }],
    watchlist: [{ ticker: "OLD", score: 7.1 }],   // OLD demoted to under-review
  }));
  const body = await res.json();
  const scoutWrites = kv.ops.putKeys.filter(k => k === "dd:scouts").length;
  const watchWrites = kv.ops.putKeys.filter(k => k === "dd:watchlist").length;
  check("dd:scouts written exactly once (merge+prune single pass)", scoutWrites === 1, `writes=${scoutWrites}`);
  check("dd:watchlist written exactly once", watchWrites === 1, `writes=${watchWrites}`);
  check("unchanged dd:gems not rewritten", !kv.ops.putKeys.includes("dd:gems"), kv.ops.putKeys.join(","));
  const scouts = JSON.parse(kv.store.get("dd:scouts"));
  check("demoted ticker pruned off scouts in the same pass",
        scouts.length === 1 && scouts[0].ticker === "NEW", JSON.stringify(scouts));
  const watch = JSON.parse(kv.store.get("dd:watchlist"));
  check("watchlist carries the demoted ticker", watch.length === 1 && watch[0].ticker === "OLD");
  check("response reports kvWrites", body.kvWrites === kv.ops.put + kv.ops.delete,
        `kvWrites=${body.kvWrites} actual=${kv.ops.put + kv.ops.delete}`);
  check("upload ok", body.ok === true);
}

// ── 2. promotion: confirmed ticker leaves the watchlist ───────────────────────
{
  const kv = mockKV({
    "dd:watchlist": JSON.stringify([{ ticker: "AAA", score: 7.6 }, { ticker: "BBB", score: 7.2 }]),
  });
  await onRequestPost(ctx(kv, { results: [], scouts: [{ ticker: "AAA", score: 7.8 }] }));
  const watch = JSON.parse(kv.store.get("dd:watchlist"));
  check("promoted ticker pruned from watchlist", watch.length === 1 && watch[0].ticker === "BBB",
        JSON.stringify(watch));
}

// ── 3. live-key deletes only when the key exists ───────────────────────────────
{
  const kv = mockKV({ "dd:live:AAA": "[]" });   // AAA has a leftover live stream; BBB doesn't
  await onRequestPost(ctx(kv, {
    results: [
      { key: "dd:AAA", value: { ticker: "AAA" } },
      { key: "dd:BBB", value: { ticker: "BBB" } },
    ],
  }));
  check("existing live key deleted", !kv.store.has("dd:live:AAA"));
  check("no delete op wasted on missing live key", kv.ops.delete === 1, `deletes=${kv.ops.delete}`);
}

// ── 4. per-ticker CDN purge keeps the uppercase key case ──────────────────────
{
  purged.length = 0;
  const kv = mockKV();
  await onRequestPost(ctx(kv, { results: [{ key: "dd:GOOG", value: { ticker: "GOOG" } }] }));
  const tickerPurges = purged.filter(u => u.includes("/api/dd/") && !/index|scouts|gems|watchlist/.test(u));
  check("purge URL preserves ticker case", tickerPurges.some(u => u.endsWith("/api/dd/GOOG")),
        purged.join(" | "));
  check("no lowercased purge URL", !tickerPurges.some(u => u.endsWith("/api/dd/goog")));
}

// ── 4b. results key allowlist: only dd:<TICKER> is writable (audit P2) ────────
{
  const kv = mockKV({ "positions:daryl": JSON.stringify([{ ticker: "AMZN", qty: 1 }]) });
  const res = await onRequestPost(ctx(kv, {
    results: [
      { key: "positions:daryl", value: [] },          // clobber attempt
      { key: "fire:daryl", value: {} },               // clobber attempt
      { key: "dd:scouts", value: [] },                // lowercase board key — not a ticker
      { key: "dd:GOOG", value: { ticker: "GOOG" } },  // legit
    ],
  }));
  const body = await res.json();
  check("non-ticker keys rejected, legit key written",
        body.written.includes("dd:GOOG")
        && !body.written.some(k => ["positions:daryl", "fire:daryl", "dd:scouts"].includes(k)),
        JSON.stringify(body.written));
  check("positions:daryl untouched",
        JSON.parse(kv.store.get("positions:daryl"))[0].qty === 1);
  check("rejected keys reported as failed", body.failed.length === 3, JSON.stringify(body.failed));
  const res2 = await onRequestPost(ctx(kv, { results: "not-an-array" }));
  check("non-array results -> 400", res2.status === 400);
}

// ── 5. board age-out: cards older than 14d prune on merge (2026-07-11) ────────
{
  const now = Date.now();
  const iso = daysAgo => new Date(now - daysAgo * 86400000).toISOString();
  const kv = mockKV({
    "dd:scouts": JSON.stringify([
      { ticker: "FRESH", score: 7.2, analyzed_at: iso(3) },
      { ticker: "EDGE",  score: 7.3, analyzed_at: iso(13) },
      { ticker: "OLD",   score: 9.9, analyzed_at: iso(20) },              // stale despite top score
      { ticker: "OLDV",  score: 8.0, verification: { checked_at: iso(30) } }, // dated only via verdict
      { ticker: "UNDATED", score: 7.0 },                                  // grandfathered
    ]),
  });
  await onRequestPost(ctx(kv, { results: [], scouts: [{ ticker: "NEW", score: 8.0 }] }));
  const scouts = JSON.parse(kv.store.get("dd:scouts")).map(s => s.ticker);
  check("fresh + edge-of-window cards survive", scouts.includes("FRESH") && scouts.includes("EDGE"), scouts.join(","));
  check("stale card pruned even at top score", !scouts.includes("OLD"), scouts.join(","));
  check("verification.checked_at counts as the card date", !scouts.includes("OLDV"), scouts.join(","));
  check("undated card grandfathered (stamp regression must not wipe boards)", scouts.includes("UNDATED"), scouts.join(","));
  check("incoming card kept", scouts.includes("NEW"), scouts.join(","));
}

// ── 5b. age-out applies to the watchlist board independently ──────────────────
{
  const iso = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const kv = mockKV({
    "dd:watchlist": JSON.stringify([
      { ticker: "WFRESH", score: 7.5, verification: { verdict: "VETO", checked_at: iso(2) } },
      { ticker: "WOLD",   score: 8.6, verification: { verdict: "REJECTED_STAGE1", checked_at: iso(19) } },
    ]),
  });
  await onRequestPost(ctx(kv, { results: [], watchlist: [{ ticker: "WNEW", score: 7.1, analyzed_at: iso(0) }] }));
  const watch = JSON.parse(kv.store.get("dd:watchlist")).map(s => s.ticker);
  check("watchlist fresh reject survives", watch.includes("WFRESH") && watch.includes("WNEW"), watch.join(","));
  check("watchlist stale reject pruned", !watch.includes("WOLD"), watch.join(","));
}

// ── 6. bad auth still rejected ─────────────────────────────────────────────────
{
  const kv = mockKV();
  const res = await onRequestPost({
    env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
    request: { url: "https://eye.example/api/dd/upload",
               headers: { get: () => "Bearer wrong" }, json: async () => ({}) },
    waitUntil: () => {},
  });
  check("wrong bearer -> 401", res.status === 401);
  check("no KV ops on auth failure", kv.ops.put + kv.ops.delete === 0);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL UPLOAD TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
