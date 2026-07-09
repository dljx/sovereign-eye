// CPF engine tests: allocation bands, BHS spillover, the age-55 RA event,
// CPF Life estimation, and how CPF enters project()/crossover().
// Run: node tests/fire-cpf.test.mjs

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FM = require(join(__dirname, "..", "fire-math.js"));

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

// ── Allocation bands (official 2026 table) ─────────────────────────────────────
{
  const b30 = FM.cpfAlloc(30), b35 = FM.cpfAlloc(35), b36 = FM.cpfAlloc(36);
  const b57 = FM.cpfAlloc(57), b75 = FM.cpfAlloc(75);
  check("age 30 → 62.17/16.21/21.62", b30[1] === 0.6217 && b30[2] === 0.1621 && b30[3] === 0.2162);
  check("age 35 stays in the '35 & below' band", b35[1] === 0.6217);
  check("age 36 moves to the next band", b36[1] === 0.5677 && b36[2] === 0.1891);
  check("age 57 → 55–60 band (RA 33.82%)", b57[2] === 0.3382 && b57[3] === 0.3088);
  check("age 75 → above-70 band (MA 84%)", b75[3] === 0.84);
  // Official worked example: $100 at age 30 → OA $62.17, SA $16.21, MA $21.62.
  check("bands sum to 1 (every band)", FM.CPF.ALLOC.every(b => Math.abs(b[1] + b[2] + b[3] - 1) < 1e-9));
}

// ── FRS / BHS escalation ───────────────────────────────────────────────────────
{
  check("FRS 2026 anchor = 220,400", FM.frsAt(2026) === 220400);
  check("FRS 2027 ≈ 228,114 (3.5% growth)", Math.abs(FM.frsAt(2027) - 220400 * 1.035) < 0.01);
  check("BHS 2026 anchor = 79,000", FM.bhsAt(2026) === 79000);
}

// ── Contribution split + SA accumulation pre-55 ───────────────────────────────
{
  // Age 30, $1,000/mo for 12 months, zero starting balances.
  const s = { birthYear: 1996, cpf: { oa: 0, sa: 0, ma: 0, monthlyContribution: 1000, includeInPlan: true } };
  const sim = FM.cpfSimulate(s, 12, new Date(2026, 0, 15));
  // 12 × $162.10 into SA, plus interest + extra interest — must exceed the raw sum.
  check("SA accumulates its allocation share", sim.sa > 12 * 162.1, String(sim.sa));
  check("nothing withdrawable before 55", sim.withdrawable.every(v => v === 0));
  check("no negative balances", sim.oa >= 0 && sim.sa >= 0 && sim.ma >= 0 && sim.ra >= 0);
}

// ── MA capped at BHS, overflow to SA pre-55 ────────────────────────────────────
{
  const s = { birthYear: 1996, cpf: { oa: 0, sa: 0, ma: 200000, monthlyContribution: 0, includeInPlan: true } };
  const sim = FM.cpfSimulate(s, 12, new Date(2026, 0, 15));
  const bhsCap = FM.bhsAt(2027); // by end of walk the cap has escalated once
  check("MA held at the BHS", sim.ma <= bhsCap + 1, `${sim.ma} vs ${bhsCap}`);
  check("MA overflow lands in SA", sim.sa > 100000, String(sim.sa));
}

// ── Age-55 event: SA closes, RA = SA then OA up to cohort FRS ─────────────────
{
  // Already 55 at the walk's start (born 1971) with big balances: RA must be
  // set to the cohort FRS, SA zeroed, remainder in OA and withdrawable.
  const s = { birthYear: 1971, cpf: { oa: 300000, sa: 300000, ma: 0, monthlyContribution: 0, includeInPlan: true } };
  const sim = FM.cpfSimulate(s, 24, new Date(2026, 0, 15));
  const cohortFrs = FM.frsAt(1971 + 55);
  check("SA is zero after 55", sim.sa === 0);
  check("RA ≈ cohort FRS (excess not swept in)", Math.abs(sim.ra - cohortFrs * Math.pow(1 + 0.04 / 12, 24)) / cohortFrs < 0.03,
        `${sim.ra} vs ~${cohortFrs}`);
  check("OA above FRS is withdrawable from 55", sim.withdrawable[23] > 250000, String(sim.withdrawable[23]));
}

// ── CPF Life estimate: calibration anchor ──────────────────────────────────────
{
  // A member with exactly the FRS in RA at 55 and nothing else must land near
  // the official ≈$1,780/mo (2026 cohort) — the factor was calibrated on it.
  const raAt65 = 220400 * Math.pow(1.04, 10);
  const est = raAt65 * FM.CPF.LIFE_FACTOR;
  check("CPF Life anchor ≈ $1,780/mo ±3%", Math.abs(est - 1780) / 1780 < 0.03, String(est));
}

// ── cpfLifeOffset: manual override wins, plan gates the auto ──────────────────
{
  const sim = { lifeMonthly: 2000 };
  check("manual override wins", FM.cpfLifeOffset({ cpfLifeMonthly: 1500, cpf: { includeInPlan: true } }, sim) === 1500);
  check("auto used when no override", FM.cpfLifeOffset({ cpfLifeMonthly: 0, cpf: { includeInPlan: true } }, sim) === 2000);
  check("no plan, no offset", FM.cpfLifeOffset({ cpfLifeMonthly: 0, cpf: { includeInPlan: false } }, sim) === 0);
}

// ── project() with a withdrawable series rides on top ─────────────────────────
{
  const s = { expectedReturn: 0, monthlyContribution: 0 };
  const wd = [0, 0, 500];
  const series = FM.project(s, 1000, 3, 0, wd);
  check("withdrawable adds to the month it exists", series[0] === 1000 && series[2] === 1500, JSON.stringify(series));
}

// ── crossover: CPF in the plan can only help ───────────────────────────────────
{
  const base = {
    monthlyExpenses: 4000, swr: 3.5, inflation: 2.5, expectedReturn: 6,
    monthlyContribution: 2000, birthYear: 1997, cpfLifeMonthly: 0,
  };
  const noCpf = { ...base, cpf: { oa: 0, sa: 0, ma: 0, monthlyContribution: 0, includeInPlan: false } };
  const withCpf = { ...base, cpf: { oa: 80000, sa: 40000, ma: 30000, monthlyContribution: 2000, includeInPlan: true } };
  const now = new Date(2026, 6, 9);
  const xoNo = FM.crossover(noCpf, 200000, now);
  const xoCpf = FM.crossover(withCpf, 200000, now);
  check("both scenarios produce a crossover", !!xoNo && !!xoCpf,
        `no=${JSON.stringify(xoNo)} cpf=${JSON.stringify(xoCpf)}`);
  if (xoNo && xoCpf) {
    check("CPF in plan never delays crossover", xoCpf.months <= xoNo.months,
          `${xoCpf.months} vs ${xoNo.months}`);
  }
}

console.log(failed ? `\n${failed} CPF TEST(S) FAILED` : "\nALL FIRE-CPF TESTS PASSED");
process.exit(failed ? 1 : 0);
