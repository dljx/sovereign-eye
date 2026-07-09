// /api/news refresh contract: the cache must ALWAYS be written after a
// successful fetch phase — even when Gemma is down or slow. Locks the fix for
// the 2026-07-09 production incident where the waitUntil (silently killed at
// ~30s) died before the single end-of-refresh KV write, leaving the news
// section permanently empty.
// Run: node tests/news.test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

// news.js imports ./_util.js and ./_gemini.js — copy all three into a tmp dir
// with a type:module package.json so the relative imports resolve as ESM.
const tmp = mkdtempSync(join(tmpdir(), "se-news-"));
writeFileSync(join(tmp, "package.json"), '{"type":"module"}');
for (const f of ["news.js", "_util.js", "_gemini.js"]) {
  writeFileSync(join(tmp, f), readFileSync(join(__dirname, "..", "functions", "api", f)));
}
const { onRequestGet } = await import(pathToFileURL(join(tmp, "news.js")).href);

// ── Mocks ───────────────────────────────────────────────────────────────────────
function mockKV() {
  const store = new Map();
  return {
    store,
    async get(k, _type) { const v = store.get(k); return v ? JSON.parse(v) : null; },
    async put(k, v, _opts) { store.set(k, v); },
  };
}

const ARTICLES = [
  { datetime: Math.floor(Date.now() / 1000) - 3600, source: "Reuters",
    headline: "Amazon beats quarterly earnings expectations on cloud growth", url: "https://x/1" },
  { datetime: Math.floor(Date.now() / 1000) - 7200, source: "Bloomberg",
    headline: "Amazon announces major logistics expansion in Asia", url: "https://x/2" },
];

let gemmaMode = "fail"; // "fail" | "ok" | "hang-ish" (slow not simulated)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("finnhub.io")) {
    return new Response(JSON.stringify(ARTICLES), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.includes("generativelanguage.googleapis.com")) {
    if (gemmaMode === "fail") return new Response("boom", { status: 500 });
    const scored = JSON.stringify([{ line: 1, ticker: "AMZN", sentiment: "bull", importance: 95, why: "earnings beat" }]);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: scored }] } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.includes("supabase")) return new Response("{}", { status: 200 });
  return new Response("not mocked: " + u, { status: 404 });
};

function ctx(env, waits) {
  return {
    request: { url: "https://eye.local/api/news?tickers=AMZN" },
    env,
    waitUntil: p => waits.push(p),
  };
}

// ── 1. Gemma down: heuristic items are STILL cached (the always-write rule) ────
{
  const env = { FINNHUB_API_KEY: "fh", GEMINI_API_KEY: "gk", DD_KV: mockKV() };
  gemmaMode = "fail";
  const waits = [];
  const res1 = await onRequestGet(ctx(env, waits));
  check("cold call returns [] + scoring", (await res1.json()).length === 0 && res1.headers.get("X-News-Status") === "scoring");
  await Promise.all(waits);

  const key = [...env.DD_KV.store.keys()].find(k => k.startsWith("news:portfolio:v1"));
  check("cache written despite Gemma failure", !!key, [...env.DD_KV.store.keys()].join(","));
  if (key) {
    const parsed = JSON.parse(env.DD_KV.store.get(key));
    check("heuristic items present", parsed.items.length > 0);
    check("heuristic write flagged pending", parsed.pending === true);
    check("heuristic importance from keywords (earnings→84)", parsed.items.some(i => i.importance === 84),
          JSON.stringify(parsed.items.map(i => i.importance)));
  }

  const res2 = await onRequestGet(ctx(env, []));
  const items2 = await res2.json();
  check("second call serves cached items", items2.length > 0);
  check("young pending cache reports scoring (client re-polls for upgrade)",
        res2.headers.get("X-News-Status") === "scoring");
}

// ── 2. Gemma up: scored upgrade replaces the heuristic write ────────────────────
{
  const env = { FINNHUB_API_KEY: "fh", GEMINI_API_KEY: "gk", DD_KV: mockKV() };
  gemmaMode = "ok";
  const waits = [];
  await onRequestGet(ctx(env, waits));
  await Promise.all(waits);

  const key = [...env.DD_KV.store.keys()].find(k => k.startsWith("news:portfolio:v1"));
  const parsed = key ? JSON.parse(env.DD_KV.store.get(key)) : null;
  check("scored cache written", !!parsed && parsed.items.length === 1, JSON.stringify(parsed?.items));
  check("gemma importance wins", parsed?.items[0]?.importance === 95);
  check("upgrade write clears pending", parsed?.pending === undefined);

  const res = await onRequestGet(ctx(env, []));
  check("upgraded cache serves as fresh", res.headers.get("X-News-Status") === "fresh");
}

// ── 3. Finnhub down: no phantom cache, still no crash ──────────────────────────
{
  const env = { FINNHUB_API_KEY: "fh", GEMINI_API_KEY: "gk", DD_KV: mockKV() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("finnhub.io")
    ? new Response("rate limited", { status: 429 })
    : realFetch(url);
  const waits = [];
  const res = await onRequestGet(ctx(env, waits));
  await Promise.all(waits);
  check("finnhub-down: returns [] without crashing", (await res.json()).length === 0);
  check("finnhub-down: no phantom cache written", env.DD_KV.store.size === 0);
  globalThis.fetch = realFetch;
}

console.log(failed ? `\n${failed} NEWS TEST(S) FAILED` : "\nALL NEWS TESTS PASSED");
process.exit(failed ? 1 : 0);
