// FIRE math — pure functions, no DOM. Plain JS (not JSX) and dual-exported so
// the node test suite can require() the exact code the browser runs.
//
// Model (Singapore context, deliberately conservative where it simplifies):
//   FIRE number(year) = inflation-adjusted annual expenses ÷ SWR.
//   From age 65 (birthYear + 65), CPF Life offsets expenses first — the payout
//   is treated as FIXED in today's dollars (Standard plan behavior; the
//   Escalating plan would only make this less conservative), so the offset
//   shrinks in real terms while expenses keep inflating.
//   Projection: monthly compounding at the expected nominal return, plus the
//   monthly contribution; CPF balance (if counted) compounds separately at its
//   own rate with no further contributions. Band = expected return ∓2pp.
(function () {

  const MONTHS_HORIZON = 40 * 12; // hard cap on any projection walk

  function n(x, fallback) {
    const v = Number(x);
    return Number.isFinite(v) ? v : fallback;
  }

  // Annual FIRE number in SGD for a calendar year, given settings `s` and the
  // year the expense figure was keyed in (baseYear — inflation anchors there).
  function fireNumberAt(year, s, baseYear) {
    const inflation = n(s.inflation, 2.5) / 100;
    const swr = n(s.swr, 3.5) / 100;
    if (swr <= 0) return Infinity;
    const years = Math.max(0, year - baseYear);
    let annualExp = n(s.monthlyExpenses, 0) * 12 * Math.pow(1 + inflation, years);
    const birthYear = n(s.birthYear, 0);
    if (birthYear > 1900 && year >= birthYear + 65) {
      annualExp = Math.max(0, annualExp - n(s.cpfLifeMonthly, 0) * 12);
    }
    return annualExp / swr;
  }

  // Current liquid assets in SGD: dashboard NLV (USD) + manual extras
  // (+ CPF balance only when explicitly counted as an asset).
  function liquidAssetsSGD(nlvUsd, sgdRate, s) {
    let v = n(nlvUsd, 0) * n(sgdRate, 1) + n(s.otherAssetsSGD, 0);
    if (s.cpf && s.cpf.includeAsAsset) v += n(s.cpf.balance, 0);
    return v;
  }

  // Project investable + (optional) CPF forward `months` months from a start
  // value. returnDeltaPct shifts the expected return (band: -2 / 0 / +2).
  // Returns an array of month-end totals, index 0 = one month from start.
  function project(s, startInvestSGD, months, returnDeltaPct) {
    const annual = (n(s.expectedReturn, 6) + n(returnDeltaPct, 0)) / 100;
    const r = Math.pow(1 + annual, 1 / 12) - 1;
    const contrib = n(s.monthlyContribution, 0);
    const cpfIncluded = !!(s.cpf && s.cpf.includeAsAsset);
    const cpfR = Math.pow(1 + n(s.cpf && s.cpf.growthRate, 4) / 100, 1 / 12) - 1;
    let cpf = cpfIncluded ? n(s.cpf && s.cpf.balance, 0) : 0;
    // startInvestSGD includes CPF when counted (liquidAssetsSGD adds it) —
    // separate it back out so the two parts compound at their own rates.
    let invest = startInvestSGD - cpf;
    const out = [];
    const capped = Math.min(Math.max(0, months | 0), MONTHS_HORIZON);
    for (let m = 0; m < capped; m++) {
      invest = invest * (1 + r) + contrib;
      cpf = cpf * (1 + cpfR);
      out.push(invest + cpf);
    }
    return out;
  }

  // First month (1-based, from `now`) where the central projection reaches the
  // FIRE line, or null within 40 years. Returns { months, date } | null.
  function crossover(s, startInvestSGD, now) {
    now = now || new Date();
    const baseYear = now.getFullYear();
    const series = project(s, startInvestSGD, MONTHS_HORIZON, 0);
    for (let m = 0; m < series.length; m++) {
      const at = new Date(now.getFullYear(), now.getMonth() + m + 1, 1);
      if (series[m] >= fireNumberAt(at.getFullYear(), s, baseYear)) {
        return { months: m + 1, date: at };
      }
    }
    return null;
  }

  const FireMath = { fireNumberAt, liquidAssetsSGD, project, crossover, MONTHS_HORIZON };

  if (typeof window !== "undefined") window.FireMath = FireMath;
  if (typeof module !== "undefined" && module.exports) module.exports = FireMath;
})();
