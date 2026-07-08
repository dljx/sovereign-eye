// Broker-sync endpoint tests — POST /api/dd/positions broker-scoped merge.
// Run: node tests/positions-sync.test.mjs

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "se-psync-"));
const copy = join(tmp, "positions.mjs");
writeFileSync(copy, readFileSync(join(__dirname, "..", "functions", "api", "dd", "positions.js")));
const { onRequestGet, onRequestPost } = await import(pathToFileURL(copy).href);

function mockKV(seed) {
  const store = new Map();
  if (seed !== undefined) store.set("positions:daryl", JSON.stringify(seed));
  return {
    store,
    async get(k, type) {
      const v = store.has(k) ? store.get(k) : null;
      return type === "json" && typeof v === "string" ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, v); },
  };
}
const ctx = (kv, { auth = "Bearer s3cret", body } = {}) => ({
  env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
  request: {
    headers: { get: k => (k === "Authorization" ? auth : null) },
    json: async () => body,
  },
});
const stored = kv => JSON.parse(kv.store.get("positions:daryl"));

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

const SEED = [
  { ticker: "AMZN", qty: 10, avg: 150, broker: "IBKR", name: "Amazon", sector: "Consumer Discretionary", industry: "E-Commerce" },
  { ticker: "GOOG", qty: 5, avg: 140, broker: "IBKR", name: "Alphabet" },
  { ticker: "HPQ.V", qty: 1000, avg: 0.5, broker: "Tiger", name: "Hopeful Ventures" },
  { ticker: "NU", qty: 50, avg: 11, broker: "Moomoo", name: "Nu Holdings" },   // non-synced broker
  { ticker: "USD", qty: 1, avg: 5000, broker: "IBKR", name: "Cash" },
];

// ── broker-scoped replace: other brokers + manual rows + USD untouched ─────────
{
  const kv = mockKV(SEED);
  const res = await onRequestPost(ctx(kv, { body: { brokers: {
    IBKR: [
      { ticker: "AMZN", qty: 12, avg: 155 },            // qty/avg changed
      { ticker: "MSFT", qty: 3, avg: 400, name: "Microsoft" }, // new
      // GOOG absent → sold
    ],
  } } }));
  const body = await res.json();
  const rows = stored(kv);
  const by = t => rows.find(r => r.ticker === t);
  check("post ok", res.status === 200 && body.ok === true);
  check("changed row updated", by("AMZN").qty === 12 && by("AMZN").avg === 155);
  check("enrichment preserved on resync", by("AMZN").sector === "Consumer Discretionary" && by("AMZN").name === "Amazon");
  check("new row added with broker tag", by("MSFT").broker === "IBKR" && by("MSFT").name === "Microsoft");
  check("sold row removed", !by("GOOG"));
  check("other synced broker untouched", by("HPQ.V").qty === 1000 && by("HPQ.V").broker === "Tiger");
  check("non-synced broker untouched", by("NU").qty === 50 && by("NU").broker === "Moomoo");
  check("USD untouched when no cash sent", by("USD").avg === 5000);
  check("diff reported", body.added.includes("IBKR:MSFT") && body.removed.includes("IBKR:GOOG") && body.updated.includes("IBKR:AMZN"),
        JSON.stringify(body));
}

// ── empty array = legitimate full exit of ONE broker; absent key = untouched ──
{
  const kv = mockKV(SEED);
  await onRequestPost(ctx(kv, { body: { brokers: { Tiger: [] } } }));
  const rows = stored(kv);
  check("Tiger wiped on explicit empty array", !rows.find(r => r.broker === "Tiger" && r.ticker !== "USD"));
  check("IBKR rows survive absent key", rows.filter(r => r.broker === "IBKR" && r.ticker !== "USD").length === 2);
}

// ── cash sums into the USD row (created if missing) ───────────────────────────
{
  const kv = mockKV(SEED.filter(r => r.ticker !== "USD"));
  await onRequestPost(ctx(kv, { body: { brokers: {}, cash: { IBKR: 3000.505, Tiger: 1200 } } }));
  const usd = stored(kv).find(r => r.ticker === "USD");
  check("USD row created from cash sum", usd && usd.avg === 4200.51 && usd.qty === 1, JSON.stringify(usd));
  check("USD broker = larger balance", usd.broker === "IBKR");
}

// ── validation ─────────────────────────────────────────────────────────────────
{
  const kv = mockKV(SEED);
  check("zero-qty rows dropped", await (async () => {
    await onRequestPost(ctx(kv, { body: { brokers: { IBKR: [{ ticker: "AMZN", qty: 0, avg: 155 }] } } }));
    return !stored(kv).find(r => r.ticker === "AMZN");
  })());
  check("bad ticker -> 400",
        (await onRequestPost(ctx(mockKV(SEED), { body: { brokers: { IBKR: [{ ticker: "lower!", qty: 1, avg: 1 }] } } }))).status === 400);
  check("USD as equity ticker -> 400",
        (await onRequestPost(ctx(mockKV(SEED), { body: { brokers: { IBKR: [{ ticker: "USD", qty: 1, avg: 1 }] } } }))).status === 400);
  check("NaN qty -> 400",
        (await onRequestPost(ctx(mockKV(SEED), { body: { brokers: { IBKR: [{ ticker: "A", qty: "x", avg: 1 }] } } }))).status === 400);
  check("unknown broker -> 400",
        (await onRequestPost(ctx(mockKV(SEED), { body: { brokers: { Robinhood: [] } } }))).status === 400);
  check("missing brokers key -> 400",
        (await onRequestPost(ctx(mockKV(SEED), { body: { cash: {} } }))).status === 400);
}

// ── auth matrix (incl. the bare-Bearer class) ──────────────────────────────────
{
  const kv = mockKV(SEED);
  check("wrong bearer -> 401", (await onRequestPost(ctx(kv, { auth: "Bearer nope", body: { brokers: {} } }))).status === 401);
  check("bare Bearer -> 401", (await onRequestPost(ctx(kv, { auth: "Bearer", body: { brokers: {} } }))).status === 401);
  check("empty Bearer -> 401", (await onRequestPost(ctx(kv, { auth: "Bearer ", body: { brokers: {} } }))).status === 401);
  check("no auth -> 401", (await onRequestPost(ctx(kv, { auth: null, body: { brokers: {} } }))).status === 401);
  check("nothing written on auth failure", JSON.stringify(stored(kv)) === JSON.stringify(SEED));
  // GET contract unchanged
  const g = await onRequestGet(ctx(kv, {}));
  const gt = await g.json();
  check("GET still returns tickers", g.status === 200 && gt.tickers.includes("AMZN") && gt.tickers.includes("USD"));
  check("GET bare Bearer -> 401", (await onRequestGet(ctx(kv, { auth: "Bearer" }))).status === 401);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL POSITIONS-SYNC TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
