// Trigger-engine dedup memory — endpoint tests.
// Run: node tests/alert-state.test.mjs

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { onRequestGet, onRequestPost } =
  await import(pathToFileURL(join(__dirname, "..", "functions", "api", "dd", "alert-state.js")).href);

function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ops = { put: 0 };
  return {
    store, ops,
    async get(k, t) { const v = store.has(k) ? store.get(k) : null; return t === "json" && typeof v === "string" ? JSON.parse(v) : v; },
    async put(k, v) { ops.put++; store.set(k, v); },
  };
}
function ctx(kv, body, auth = "Bearer s3cret") {
  return { env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
    request: { url: "https://x/api/dd/alert-state", headers: { get: k => (k === "Authorization" ? auth : null) }, json: async () => body },
    waitUntil: () => {} };
}
let failed = 0;
const check = (n, c, d = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : ` [${d}]`}`); };
const doc = kv => JSON.parse(kv.store.get("alerts:state:v1"));

// auth
{
  const kv = mockKV();
  check("GET no bearer -> 401", (await onRequestGet(ctx(kv, null, null))).status === 401);
  check("POST wrong bearer -> 401", (await onRequestPost(ctx(kv, { fired: [] }, "Bearer x"))).status === 401);
  check("no writes on auth fail", kv.ops.put === 0);
}
// stamp + read
{
  const kv = mockKV();
  const res = await onRequestPost(ctx(kv, { fired: ["NVDA|entry_window", "AMZN|target_reached"] }));
  const body = await res.json();
  check("stamp ok", body.ok === true && body.kvWrites === 1);
  const d = doc(kv);
  check("both keys stamped with ISO ts", !!Date.parse(d["NVDA|entry_window"]) && !!Date.parse(d["AMZN|target_reached"]));
  const got = await (await onRequestGet(ctx(kv, null))).json();
  check("GET returns the map", got["NVDA|entry_window"] === d["NVDA|entry_window"]);
}
// validation + normalization
{
  const kv = mockKV();
  check("bad key -> 400", (await onRequestPost(ctx(kv, { fired: ["NVDA entry"] }))).status === 400);
  check("fired not array -> 400", (await onRequestPost(ctx(kv, { fired: {} }))).status === 400);
  await onRequestPost(ctx(kv, { fired: ["nvda|Entry_Window"] }));
  check("ticker upper + rule lower normalized", !!doc(kv)["NVDA|entry_window"], JSON.stringify(doc(kv)));
}
// GC of stale keys
{
  const old = new Date(Date.now() - 70 * 86400000).toISOString();
  const kv = mockKV({ "alerts:state:v1": JSON.stringify({ "OLD|entry_window": old }) });
  await onRequestPost(ctx(kv, { fired: ["NEW|entry_window"] }));
  const d = doc(kv);
  check("stale key GC'd, fresh kept", !d["OLD|entry_window"] && !!d["NEW|entry_window"], JSON.stringify(d));
}

console.log(failed === 0 ? "\nALL ALERT-STATE TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
