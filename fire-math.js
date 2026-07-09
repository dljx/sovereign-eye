// FIRE math — pure functions, no DOM. Plain JS (not JSX) and dual-exported so
// the node test suite can require() the exact code the browser runs.
//
// Model (Singapore context, deliberately conservative where it simplifies):
//   FIRE number(year) = inflation-adjusted annual expenses ÷ SWR.
//   From age 65 (birthYear + 65), CPF Life offsets expenses first — the payout
//   is FIXED in nominal dollars from 65 (Standard plan behavior), so the
//   offset shrinks in real terms while expenses keep inflating.
//   Projection: monthly compounding at the expected nominal return, plus the
//   monthly contribution. Band = expected return ∓2pp.
//
// CPF engine (cpfSimulate): walks OA/SA/MA month by month using the official
// allocation table, account interest floors, extra-interest tiers, the BHS cap
// on MA, the age-55 event (SA closes, RA formed up to the cohort FRS), and
// estimates the CPF Life payout from RA at 65. CPF money enters the FIRE plan
// only two ways, both honest about lock-up:
//   - OA from age 55 counts as withdrawable (kept compounding at the OA rate —
//     conservative vs. moving it to equities),
//   - RA turns into the CPF Life offset from 65.
// SA/MA are never counted as spendable. Pre-55 CPF never inflates "liquid".
(function () {

  const MONTHS_HORIZON = 40 * 12; // hard cap on any projection walk

  // ── CPF constants (official; dd's quarterly fire_check reviews these) ──────
  // Allocation ratios effective 1 Jan 2026 (cpf.gov.sg). MA is computed first,
  // then SA (RA from 55), remainder to OA. Bands: [maxAge inclusive, oa, sra, ma].
  const CPF = {
    ALLOC: [
      [35, 0.6217, 0.1621, 0.2162],
      [45, 0.5677, 0.1891, 0.2432],
      [50, 0.5136, 0.2162, 0.2702],
      [55, 0.4055, 0.3108, 0.2837],
      [60, 0.3530, 0.3382, 0.3088],
      [65, 0.1400, 0.4400, 0.4200],
      [70, 0.0607, 0.3030, 0.6363],
      [Infinity, 0.08, 0.08, 0.84],
    ],
    OA_RATE: 2.5,   // %/yr floor
    SMRA_RATE: 4.0, // %/yr floor (SA/MA/RA; floor extended through 2026)
    FRS: { year: 2026, value: 220400, growth: 3.5 }, // %/yr escalation, cohort-fixed at your 55
    BHS: { year: 2026, value: 79000, growth: 4.6 },  // MA cap; fixed from your age-65 year
    // CPF Life Standard plan: $/month per $ of RA at 65. Calibrated on the
    // official 2026 anchor — FRS $220,400 set aside at 55 → ≈$1,780/mo from 65
    // (220,400 × 1.04^10 ≈ $326k at 65; 1780/326246 ≈ 0.00546).
    LIFE_FACTOR: 0.00546,
  };

  function n(x, fallback) {
    const v = Number(x);
    return Number.isFinite(v) ? v : fallback;
  }

  function cpfAlloc(age) {
    return CPF.ALLOC.find(b => age <= b[0]);
  }
  function frsAt(year) {
    return CPF.FRS.value * Math.pow(1 + CPF.FRS.growth / 100, year - CPF.FRS.year);
  }
  function bhsAt(year) {
    return CPF.BHS.value * Math.pow(1 + CPF.BHS.growth / 100, year - CPF.BHS.year);
  }

  // Walk the CPF accounts forward. Returns:
  //   withdrawable[m] — the CPF you could hold as cash at month m (OA from 55, else 0)
  //   lifeMonthly     — estimated CPF Life payout (nominal $/mo from age 65)
  //   raAt65, oa/sa/ma/ra — end/inspection values for display and tests.
  // Internally always simulates at least until age 66 (capped at 55 years) so
  // the CPF Life estimate exists even when the caller's horizon is shorter.
  function cpfSimulate(s, months, now) {
    now = now || new Date();
    const c = s.cpf || {};
    const birthYear = n(s.birthYear, 0);
    let oa = n(c.oa, 0), sa = n(c.sa, 0), ma = n(c.ma, 0), ra = n(c.ra, 0);
    const contrib = n(c.monthlyContribution, 0);
    const oaR = Math.pow(1 + CPF.OA_RATE / 100, 1 / 12) - 1;
    const sraR = Math.pow(1 + CPF.SMRA_RATE / 100, 1 / 12) - 1;

    const capped = Math.min(Math.max(0, months | 0), MONTHS_HORIZON);
    let internal = capped;
    if (birthYear > 1900) {
      const monthsTo66 = Math.max(0, (birthYear + 66 - now.getFullYear()) * 12 - now.getMonth());
      internal = Math.min(Math.max(capped, monthsTo66), 55 * 12);
    }

    let cohortFrs = null;
    let raAt65 = null;
    const withdrawable = [];
    // Balances reported to the caller are at THEIR horizon (capped), even
    // though the walk continues to age 66 for the CPF Life estimate.
    let snap = { oa, sa, ma, ra };

    for (let m = 0; m < internal; m++) {
      const at = new Date(now.getFullYear(), now.getMonth() + m + 1, 1);
      const year = at.getFullYear();
      const age = birthYear > 1900 ? year - birthYear : 0;

      // Age-55 event: SA closes. RA is formed from SA first, then OA, up to
      // the cohort FRS (fixed at the year you turn 55); the rest stays in OA.
      if (age >= 55 && cohortFrs === null) {
        cohortFrs = frsAt(birthYear + 55);
        const fromSa = Math.min(sa, Math.max(0, cohortFrs - ra));
        sa -= fromSa; ra += fromSa;
        const fromOa = Math.min(oa, Math.max(0, cohortFrs - ra));
        oa -= fromOa; ra += fromOa;
        oa += sa; sa = 0;
      }

      // Contribution split (official order: MA first, then SA/RA, rest to OA).
      if (contrib > 0 && age > 0) {
        const band = cpfAlloc(age);
        const maAdd = contrib * band[3];
        const sraAdd = contrib * band[2];
        oa += contrib - maAdd - sraAdd;
        ma += maAdd;
        if (age >= 55) {
          const toRa = Math.min(sraAdd, Math.max(0, cohortFrs - ra));
          ra += toRa; oa += sraAdd - toRa; // RA at FRS → channelled to OA
        } else {
          sa += sraAdd;
        }
      }

      // Interest at the floors + extra interest (approximation: extra is
      // computed on combined balances and credited to the SA/RA side; the
      // official per-account ordering and the $20k OA sub-cap are ignored —
      // the error is a few dollars a month, always in the same direction).
      const total = oa + sa + ma + ra;
      const extra = age >= 55
        ? 0.02 * Math.min(total, 30000) + 0.01 * Math.max(0, Math.min(total - 30000, 30000))
        : 0.01 * Math.min(total, 60000);
      oa *= 1 + oaR; sa *= 1 + sraR; ma *= 1 + sraR; ra *= 1 + sraR;
      if (age >= 55) ra += extra / 12; else sa += extra / 12;

      // MA is capped at the BHS (frozen from your age-65 year); the overflow
      // spills to SA before 55, to RA (up to FRS) then OA after.
      const bhs = bhsAt(birthYear > 1900 ? Math.min(year, birthYear + 65) : year);
      if (ma > bhs) {
        const spill = ma - bhs;
        ma = bhs;
        if (age >= 55) {
          const toRa = Math.min(spill, Math.max(0, (cohortFrs == null ? Infinity : cohortFrs) - ra));
          ra += toRa; oa += spill - toRa;
        } else {
          sa += spill;
        }
      }

      if (raAt65 === null && birthYear > 1900 && age >= 65) raAt65 = ra;
      if (m < capped) withdrawable.push(age >= 55 ? oa : 0);
      if (m === capped - 1) snap = { oa, sa, ma, ra };
    }

    const lifeMonthly = raAt65 != null ? raAt65 * CPF.LIFE_FACTOR : 0;
    return { withdrawable, raAt65, lifeMonthly, ...snap };
  }

  // Effective CPF Life offset used by the FIRE line: a manual figure wins;
  // otherwise the simulated estimate (only when CPF is modeled in the plan).
  function cpfLifeOffset(s, sim) {
    const manual = n(s.cpfLifeMonthly, 0);
    if (manual > 0) return manual;
    return s.cpf && s.cpf.includeInPlan && sim ? sim.lifeMonthly : 0;
  }

  // Annual FIRE number in SGD for a calendar year, given settings `s` and the
  // year the expense figure was keyed in (baseYear — inflation anchors there).
  // `lifeMonthly` (optional) is the CPF Life offset from age 65 — nominal,
  // fixed from 65, as the Standard plan pays.
  function fireNumberAt(year, s, baseYear, lifeMonthly) {
    const inflation = n(s.inflation, 2.5) / 100;
    const swr = n(s.swr, 3.5) / 100;
    if (swr <= 0) return Infinity;
    const years = Math.max(0, year - baseYear);
    let annualExp = n(s.monthlyExpenses, 0) * 12 * Math.pow(1 + inflation, years);
    const birthYear = n(s.birthYear, 0);
    if (birthYear > 1900 && year >= birthYear + 65) {
      const offset = lifeMonthly != null ? n(lifeMonthly, 0) : n(s.cpfLifeMonthly, 0);
      annualExp = Math.max(0, annualExp - offset * 12);
    }
    return annualExp / swr;
  }

  // Current liquid assets in SGD: dashboard NLV (USD) + manual extras. CPF is
  // NOT here — pre-55 it is locked, and from 55 it enters via the projection's
  // withdrawable series instead (never double-counted).
  function liquidAssetsSGD(nlvUsd, sgdRate, s) {
    return n(nlvUsd, 0) * n(sgdRate, 1) + n(s.otherAssetsSGD, 0);
  }

  // Project investable assets forward `months` months. returnDeltaPct shifts
  // the expected return (band: -2 / 0 / +2). When `cpfWithdrawable` (from
  // cpfSimulate) is given, each month's total adds the CPF that would be
  // withdrawable then — it compounds inside CPF at CPF rates, not the
  // portfolio rate. Returns month-end totals, index 0 = one month from start.
  function project(s, startInvestSGD, months, returnDeltaPct, cpfWithdrawable) {
    const annual = (n(s.expectedReturn, 6) + n(returnDeltaPct, 0)) / 100;
    const r = Math.pow(1 + annual, 1 / 12) - 1;
    const contrib = n(s.monthlyContribution, 0);
    let invest = n(startInvestSGD, 0);
    const out = [];
    const capped = Math.min(Math.max(0, months | 0), MONTHS_HORIZON);
    for (let m = 0; m < capped; m++) {
      invest = invest * (1 + r) + contrib;
      out.push(invest + (cpfWithdrawable ? n(cpfWithdrawable[m], 0) : 0));
    }
    return out;
  }

  // First month (1-based, from `now`) where the central projection reaches the
  // FIRE line, or null within 40 years. CPF (when modeled) enters both sides:
  // the asset line via the withdrawable series, the FIRE line via CPF Life.
  function crossover(s, startInvestSGD, now) {
    now = now || new Date();
    const baseYear = now.getFullYear();
    const inPlan = !!(s.cpf && s.cpf.includeInPlan);
    const sim = inPlan || n(s.cpfLifeMonthly, 0) > 0 ? cpfSimulate(s, MONTHS_HORIZON, now) : null;
    const life = cpfLifeOffset(s, sim);
    const series = project(s, startInvestSGD, MONTHS_HORIZON, 0, inPlan && sim ? sim.withdrawable : null);
    for (let m = 0; m < series.length; m++) {
      const at = new Date(now.getFullYear(), now.getMonth() + m + 1, 1);
      if (series[m] >= fireNumberAt(at.getFullYear(), s, baseYear, life)) {
        return { months: m + 1, date: at };
      }
    }
    return null;
  }

  const FireMath = {
    fireNumberAt, liquidAssetsSGD, project, crossover,
    cpfSimulate, cpfAlloc, cpfLifeOffset, frsAt, bhsAt,
    CPF, MONTHS_HORIZON,
  };

  if (typeof window !== "undefined") window.FireMath = FireMath;
  if (typeof module !== "undefined" && module.exports) module.exports = FireMath;
})();
