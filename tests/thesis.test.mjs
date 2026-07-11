// Thesis registry — endpoint regression tests.
// Run: node tests/thesis.test.mjs
//
// Locks the 2026-07-11 anti-drift contract:
//   - the registered thesis TEXT is a stable anchor: POST seeds it once and
//     never rewrites it; only a manual PUT (or reset) changes it
//   - POST requires a Bearer (a browser session must not fake check results)
//   - departed tickers leave the registry only when `held` is provided
//   - PUT flips source to "manual"; reset deletes for re-seeding

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { onRequestGet, onRequestPost, onRequestPut } =
  await import(pathToFileURL(join(__dirname, "..", "functions", "api", "dd", "thesis.js")).href);

function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ops = { put: 0 };
  return {
    store, ops,
    async get(k, type) {
      const v = store.has(k) ? store.get(k) : null;
      return type === "json" && typeof v === "string" ? JSON.parse(v) : v;
    },
    async put(k, v) { ops.put++; store.set(k, v); },
  };
}

function ctx(kv, body, auth) {
  return {
    env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
    request: {
      url: "https://eye.example/api/dd/thesis",
      headers: { get: k => (k === "Authorization" ? auth : null) },
      json: async () => body,
    },
    waitUntil: () => {},
  };
}
const asDd = "Bearer s3cret";
const asBrowser = null; // Basic-auth passed middleware; no Bearer header here

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

const doc = kv => JSON.parse(kv.store.get("thesis:daryl"));

// ── 1. POST auth: bearer required, browser rejected ───────────────────────────
{
  const kv = mockKV();
  const r1 = await onRequestPost(ctx(kv, { checks: {} }, asBrowser));
  const r2 = await onRequestPost(ctx(kv, { checks: {} }, "Bearer wrong"));
  check("POST without bearer -> 401", r1.status === 401);
  check("POST wrong bearer -> 401", r2.status === 401);
  check("no writes on auth failure", kv.ops.put === 0);
}

// ── 2. seed once, then never rewrite the thesis text ──────────────────────────
{
  const kv = mockKV();
  await onRequestPost(ctx(kv, { checks: { AMZN: {
    status: "INTACT", adherence: 8.5, reason: "thesis holds",
    seed_thesis: "AWS margin expansion drives FCF inflection",
    seed_key_swing: "AWS growth re-acceleration",
  } } }, asDd));
  let d = doc(kv);
  check("seeded with system source", d.AMZN.source === "system" && d.AMZN.thesis.includes("AWS"));
  check("check fields stored", d.AMZN.status === "INTACT" && d.AMZN.adherence === 8.5);

  await onRequestPost(ctx(kv, { checks: { AMZN: {
    status: "STRAINED", adherence: 5, reason: "margin compression 2 quarters",
    seed_thesis: "A DIFFERENT thesis that must NOT overwrite",
  } } }, asDd));
  d = doc(kv);
  check("thesis text never rewritten by POST", d.AMZN.thesis.includes("AWS margin expansion"),
        d.AMZN.thesis);
  check("check result updated", d.AMZN.status === "STRAINED" && d.AMZN.adherence === 5);
}

// ── 3. no seed text + unknown ticker → skipped silently ───────────────────────
{
  const kv = mockKV();
  const res = await onRequestPost(ctx(kv, { checks: { NEWCO: { status: "INTACT" } } }, asDd));
  const body = await res.json();
  check("seedless new ticker skipped", body.ok === true && !kv.store.has("thesis:daryl"),
        JSON.stringify(body));
}

// ── 4. held[] prunes departed tickers ──────────────────────────────────────────
{
  const kv = mockKV({
    "thesis:daryl": JSON.stringify({
      AMZN: { thesis: "t", source: "system" },
      SOLD: { thesis: "t", source: "manual" },
    }),
  });
  const res = await onRequestPost(ctx(kv, {
    checks: { AMZN: { status: "INTACT", seed_thesis: "x" } },
    held: ["AMZN"],
  }, asDd));
  const body = await res.json();
  const d = doc(kv);
  check("departed ticker removed", !d.SOLD && body.removed.includes("SOLD"));
  check("held ticker survives", !!d.AMZN);
}
{
  const kv = mockKV({ "thesis:daryl": JSON.stringify({ KEEP: { thesis: "t", source: "manual" } }) });
  await onRequestPost(ctx(kv, { checks: {} }, asDd));
  check("entry intact when held[] is absent", !!doc(kv).KEEP);
}

// ── 4b. empty held[] must NEVER wipe the registry (audit P1) ───────────────────
{
  const kv = mockKV({
    "thesis:daryl": JSON.stringify({
      AMZN: { thesis: "manual anchor", source: "manual" },
      GOOG: { thesis: "system", source: "system" },
    }),
  });
  const res = await onRequestPost(ctx(kv, { checks: {}, held: [] }, asDd));
  const body = await res.json();
  const d = doc(kv);
  check("held:[] prunes nothing", !!d.AMZN && !!d.GOOG && body.removed.length === 0,
        JSON.stringify(body));
}

// ── 5. validation ──────────────────────────────────────────────────────────────
{
  const kv = mockKV();
  const bad = async body => (await onRequestPost(ctx(kv, body, asDd))).status;
  check("bad ticker -> 400", await bad({ checks: { "bad ticker!": { status: "INTACT" } } }) === 400);
  check("bad status -> 400", await bad({ checks: { AMZN: { status: "MEHH" } } }) === 400);
  check("checks not object -> 400", await bad({ checks: [] }) === 400);
}

// ── 6. PUT: manual edit + reset ────────────────────────────────────────────────
{
  const kv = mockKV({
    "thesis:daryl": JSON.stringify({
      AMZN: { thesis: "system version", source: "system", status: "INTACT" },
    }),
  });
  await onRequestPut(ctx(kv, { ticker: "amzn", thesis: "MY actual reason for owning" }, asBrowser));
  let d = doc(kv);
  check("PUT flips to manual + keeps check fields",
        d.AMZN.source === "manual" && d.AMZN.thesis.startsWith("MY actual")
        && d.AMZN.status === "INTACT", JSON.stringify(d.AMZN));

  await onRequestPut(ctx(kv, { ticker: "AMZN", reset: true }, asBrowser));
  d = doc(kv);
  check("PUT reset deletes for re-seed", !d.AMZN);

  const r = await onRequestPut(ctx(kv, { ticker: "AMZN", thesis: "" }, asBrowser));
  check("PUT empty thesis -> 400", r.status === 400);
  const r2 = await onRequestPut(ctx(kv, { ticker: "X", thesis: "t" }, "Bearer wrong"));
  check("PUT wrong bearer -> 401", r2.status === 401);
}

// ── 7. GET returns the registry; bearer + browser both allowed ─────────────────
{
  const kv = mockKV({ "thesis:daryl": JSON.stringify({ AMZN: { thesis: "t" } }) });
  const g1 = await (await onRequestGet(ctx(kv, null, asDd))).json();
  const g2 = await (await onRequestGet(ctx(kv, null, asBrowser))).json();
  check("GET with dd bearer", g1.AMZN.thesis === "t");
  check("GET as browser", g2.AMZN.thesis === "t");
  const g3 = await onRequestGet(ctx(kv, null, "Bearer wrong"));
  check("GET wrong bearer -> 401", g3.status === 401);
}

// ── 8. idempotent POST skips the write ─────────────────────────────────────────
{
  const kv = mockKV();
  const payload = { checks: { AMZN: { status: "INTACT", adherence: 8, reason: "r",
                                      checked_at: "2026-07-11T00:00:00Z",
                                      seed_thesis: "t" } } };
  await onRequestPost(ctx(kv, payload, asDd));
  const putsAfterFirst = kv.ops.put;
  const res = await onRequestPost(ctx(kv, payload, asDd));
  const body = await res.json();
  check("identical re-POST skips KV write", kv.ops.put === putsAfterFirst && body.kvWrites === 0,
        `puts=${kv.ops.put}`);
}

console.log(failed === 0 ? "\nALL THESIS TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
