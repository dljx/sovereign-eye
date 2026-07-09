// FIRE feature tests: the /api/fire endpoint contract + FireMath exact values.
// Run: node tests/fire.test.mjs

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

// ── FireMath: exact-value checks on the pure functions ─────────────────────────
const FM = require(join(__dirname, "..", "fire-math.js"));

{
  // Classic SWR: S$4,000/mo, 3.5% SWR, base year — no inflation elapsed.
  const s = { monthlyExpenses: 4000, swr: 3.5, inflation: 2.5 };
  const fire0 = FM.fireNumberAt(2026, s, 2026);
  check("fireNumberAt base year = 12*4000/0.035", Math.abs(fire0 - 1371428.57) < 1, String(fire0));

  // 10 years of 2.5% inflation compounds the expenses.
  const fire10 = FM.fireNumberAt(2036, s, 2026);
  const expected10 = (4000 * 12 * Math.pow(1.025, 10)) / 0.035;
  check("fireNumberAt inflates over 10y", Math.abs(fire10 - expected10) < 1, `${fire10} vs ${expected10}`);
}

{
  // CPF Life steps the number down from age 65 — and the payout is NOT inflated.
  const s = { monthlyExpenses: 4000, swr: 3.5, inflation: 2.5, birthYear: 1997, cpfLifeMonthly: 1500 };
  const at64 = FM.fireNumberAt(2061, s, 2026);   // age 64 — no offset
  const at65 = FM.fireNumberAt(2062, s, 2026);   // age 65 — offset kicks in
  const exp65 = 4000 * 12 * Math.pow(1.025, 36); // inflated expenses at 2062
  check("no CPF offset before 65", Math.abs(at64 - (4000 * 12 * Math.pow(1.025, 35)) / 0.035) < 1);
  check("CPF Life offsets fixed S$18k/yr at 65", Math.abs(at65 - (exp65 - 18000) / 0.035) < 1,
        `${at65} vs ${(exp65 - 18000) / 0.035}`);
  // Offset can't push the requirement negative.
  const s2 = { ...s, cpfLifeMonthly: 999999 };
  check("offset floors at zero", FM.fireNumberAt(2062, s2, 2026) === 0);
}

{
  // Liquid assets: NLV(USD)→SGD + extras. CPF is NEVER in "liquid now" — it
  // enters the plan via the projection (OA at 55) and CPF Life (65) instead.
  const s = { otherAssetsSGD: 50000, cpf: { oa: 100000, includeInPlan: false } };
  check("liquid excludes CPF when not in plan", FM.liquidAssetsSGD(100000, 1.3, s) === 180000);
  s.cpf.includeInPlan = true;
  check("liquid still excludes CPF when in plan (no double count)", FM.liquidAssetsSGD(100000, 1.3, s) === 180000);
}

{
  // Projection: zero return + fixed contribution = pure accumulation.
  const s = { expectedReturn: 0, monthlyContribution: 1000, cpf: { includeAsAsset: false } };
  const series = FM.project(s, 10000, 12, 0);
  check("projection accumulates contributions", Math.abs(series[11] - 22000) < 0.01, String(series[11]));
  // Band ordering: +2pp beats central beats -2pp.
  const s2 = { expectedReturn: 6, monthlyContribution: 0, cpf: { includeAsAsset: false } };
  const hi = FM.project(s2, 100000, 120, 2), mid = FM.project(s2, 100000, 120, 0), lo = FM.project(s2, 100000, 120, -2);
  check("band ordering hi>mid>lo", hi[119] > mid[119] && mid[119] > lo[119]);
}

{
  // Crossover: already past the FIRE number → first month.
  const s = { monthlyExpenses: 1000, swr: 4, inflation: 0, expectedReturn: 5, monthlyContribution: 0 };
  const xo = FM.crossover(s, 400000, new Date(2026, 0, 15));  // need 300k, have 400k
  check("crossover immediate when already there", xo && xo.months === 1, JSON.stringify(xo));
  // Unreachable: zero return, zero contribution, below the line forever.
  const s2 = { monthlyExpenses: 5000, swr: 3.5, inflation: 2.5, expectedReturn: 0, monthlyContribution: 0 };
  check("crossover null when unreachable", FM.crossover(s2, 10000, new Date(2026, 0, 15)) === null);
}

// ── /api/fire endpoint (mock KV, same harness style as upload.test.mjs) ───────
const tmp = mkdtempSync(join(tmpdir(), "se-fire-"));
const copy = join(tmp, "fire.mjs");
writeFileSync(copy, readFileSync(join(__dirname, "..", "functions", "api", "fire", "index.js")));
const { onRequestGet, onRequestPut } = await import(pathToFileURL(copy).href);

function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k, type) {
      const v = store.has(k) ? store.get(k) : null;
      return type === "json" && typeof v === "string" ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, v); },
  };
}
const ctx = (kv, { auth = null, body = undefined } = {}) => ({
  env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
  request: {
    headers: { get: k => (k === "Authorization" ? auth : null) },
    json: async () => body,
  },
});

{
  const kv = mockKV();
  const r = await onRequestGet(ctx(kv));
  check("GET (Basic path, no bearer) empty -> 200 {}", r.status === 200 && JSON.stringify(await r.json()) === "{}");
}
{
  const kv = mockKV();
  const put = await onRequestPut(ctx(kv, { body: { monthlyExpenses: 4200, swr: 3.5 } }));
  check("PUT object -> ok", put.status === 200 && (await put.json()).ok === true);
  const stored = JSON.parse(kv.store.get("fire:daryl"));
  check("PUT stamps updatedAt", typeof stored.updatedAt === "string" && stored.monthlyExpenses === 4200);
  const get = await onRequestGet(ctx(kv, { auth: "Bearer s3cret" }));
  check("GET with correct bearer -> 200 + settings", get.status === 200 && (await get.json()).monthlyExpenses === 4200);
}
{
  const kv = mockKV();
  check("GET with wrong bearer -> 401", (await onRequestGet(ctx(kv, { auth: "Bearer nope" }))).status === 401);
  check("PUT with ANY bearer -> 403 (human-owned settings)",
        (await onRequestPut(ctx(kv, { auth: "Bearer s3cret", body: { swr: 99 } }))).status === 403);
  check("PUT array -> 400", (await onRequestPut(ctx(kv, { body: [1, 2] }))).status === 400);
  check("nothing stored on rejected writes", !kv.store.has("fire:daryl"));
}
{
  // The live 2026-07-08 finding: a BARE "Bearer" (no token) must never read
  // like an authenticated Basic session — even if the middleware regressed.
  const kv = mockKV({ "fire:daryl": JSON.stringify({ swr: 3.5 }) });
  check("bare Bearer GET -> 401", (await onRequestGet(ctx(kv, { auth: "Bearer" }))).status === 401);
  check("empty Bearer GET -> 401", (await onRequestGet(ctx(kv, { auth: "Bearer " }))).status === 401);
  check("bare Bearer PUT -> 403", (await onRequestPut(ctx(kv, { auth: "Bearer", body: { swr: 1 } }))).status === 403);
  check("empty Bearer PUT -> 403", (await onRequestPut(ctx(kv, { auth: "Bearer ", body: { swr: 1 } }))).status === 403);
  check("junk not written", JSON.parse(kv.store.get("fire:daryl")).swr === 3.5);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL FIRE TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
