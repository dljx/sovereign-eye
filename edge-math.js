// Edge & Exposure math — pure functions, no DOM. Plain JS (not JSX), dual-
// exported so the node test suite runs the exact code the browser runs
// (mirrors fire-math.js).
//
// Philosophy (Daryl, 2026-07-12): concentration builds wealth, diversification
// preserves it — so size by EDGE, and the enemy is UNINTENTIONAL / DECAYED-edge
// concentration. This maps capital against the conviction the engine already
// computed, so concentration is earned and intentional.
//
// HONEST CALIBRATION: the RANK, the earned/drift classification, and the
// direction (under/over-weight your edge) are the load-bearing outputs. The
// ¼-Kelly PERCENTAGE is illustrative — its `p = f(score)` map is unvalidated
// until the ~Sep scoreboard read. Treat the % as a soft prompt, never a target.
(function () {
  const THESIS_MULT = { INTACT: 1.0, STRAINED: 0.8, BROKEN: 0.4 };
  const KELLY_FRACTION = 0.25;   // quarter-Kelly: conservative on an unproven edge
  const KELLY_CAP = 0.15;        // never suggest >15% of NLV to one name
  const P_CAP = 0.72;            // never claim >72% win probability from a score
  const STALE_DAYS = 10;         // an index entry older than this = no live view

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Conviction score → win probability, deliberately conservative. This is the
  // weakest, unvalidated link — see the file header.
  function winProb(score) {
    if (!Number.isFinite(score)) return null;
    return clamp(0.40 + 0.055 * (score - 5), 0.40, P_CAP);
  }

  // Quarter-Kelly suggested weight (fraction of NLV) from R:R and conviction.
  // Returns null when we lack a usable payoff ratio (rank-only for that name).
  function suggestedWeight(score, rr, thesisStatus) {
    const b = Number(rr);
    if (!(b > 0)) return null;
    if (thesisStatus === "BROKEN") return 0; // a broken thesis is not an add
    let p = winProb(score);
    if (p == null) return null;
    if (thesisStatus === "STRAINED") p *= 0.9;
    const f = (b * p - (1 - p)) / b;         // full Kelly fraction
    if (!(f > 0)) return 0;
    return Math.min(f * KELLY_FRACTION, KELLY_CAP);
  }

  function edgeScore(score, thesisStatus) {
    if (!Number.isFinite(score)) return null;
    const mult = thesisStatus in THESIS_MULT ? THESIS_MULT[thesisStatus] : 0.92;
    return +(score * mult).toFixed(2);
  }

  function ageDays(updated, now) {
    const t = Date.parse(updated || "");
    return Number.isFinite(t) ? (now - t) / 86400000 : Infinity;
  }

  // positions: [{ticker,qty,avg,broker}] (+ a USD cash row). quotes: {T:{c}}.
  // index: {T:{score,rr,fv,sizePct,sector,beta,updated}}. theses: {T:{status,adherence}}.
  // confirmCards: [{ticker,score,verdict,fair_value_composite,price}] (scout/gems boards).
  function computeEdgeMap(positions, quotes, index, theses, confirmCards, opts) {
    const now = (opts && opts.now) || Date.now();
    index = index || {}; theses = theses || {}; quotes = quotes || {};
    const held = new Set();
    let cash = 0, nlv = 0;

    const rows = [];
    for (const p of positions || []) {
      const ticker = String(p && p.ticker || "").toUpperCase();
      if (!ticker) continue;
      if (ticker === "USD") { cash += Number(p.avg) || 0; nlv += Number(p.avg) || 0; continue; }
      held.add(ticker);
      const q = quotes[ticker] || {};
      const px = Number(q.c) || 0;
      const mv = px * (Number(p.qty) || 0);
      nlv += mv;
      const ix = index[ticker] || null;
      const th = theses[ticker] || {};
      rows.push({ ticker, broker: p.broker || "", qty: Number(p.qty) || 0, px, mv,
                  score: ix ? Number(ix.score) : null,
                  rr: ix ? Number(ix.rr) : null,
                  fv: ix ? Number(ix.fv) : null,
                  sizePct: ix ? Number(ix.sizePct) : null,
                  thesisStatus: th.status || null,
                  thesisAdherence: th.adherence != null ? Number(th.adherence) : null,
                  stale: !ix || ageDays(ix.updated, now) > STALE_DAYS });
    }

    // Weights + edge + Kelly. Median over equity holdings for the concentration test.
    const weights = rows.map(r => (nlv > 0 ? r.mv / nlv : 0));
    const sorted = [...weights].sort((a, b) => a - b);
    const medianW = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;

    for (const r of rows) {
      r.weight = nlv > 0 ? r.mv / nlv : 0;
      r.edge = edgeScore(r.score, r.thesisStatus);
      const sug = suggestedWeight(r.score, r.rr, r.thesisStatus);
      r.suggestedPct = sug == null ? null : +(sug * 100).toFixed(1);
      r.actualPct = +(r.weight * 100).toFixed(1);
      r.deltaPct = r.suggestedPct == null ? null : +(r.actualPct - r.suggestedPct).toFixed(1);

      const big = r.weight >= medianW;
      const noView = r.stale || r.score == null;
      const weakThesis = r.thesisStatus === "BROKEN" || r.thesisStatus === "STRAINED";
      if (big && r.score != null && r.score >= 7 && r.thesisStatus === "INTACT") {
        r.klass = "EARNED";
      } else if (big && (noView || (r.score != null && r.score < 6.5) || weakThesis)) {
        r.klass = "DRIFT";
      } else if (r.score != null && r.score >= 7.5 && r.suggestedPct != null
                 && r.actualPct < r.suggestedPct * 0.5) {
        r.klass = "UNDERWEIGHT";
      } else {
        r.klass = "NEUTRAL";
      }
    }
    rows.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

    // Conviction-vs-holdings gaps.
    const bestByTicker = {};
    for (const c of confirmCards || []) {
      const t = String(c && c.ticker || "").toUpperCase();
      const verdict = String((c.verification && c.verification.verdict) || c.verdict || "").toUpperCase();
      if (!t || verdict !== "CONFIRM" || held.has(t)) continue;
      const sc = Number(c.score);
      if (!bestByTicker[t] || sc > bestByTicker[t].score) {
        bestByTicker[t] = { ticker: t, score: sc,
                            fv: c.fair_value_composite != null ? Number(c.fair_value_composite) : null,
                            price: c.price != null ? Number(c.price) : null };
      }
    }
    const unowned = Object.values(bestByTicker).sort((a, b) => b.score - a.score).slice(0, 8);

    // Held, but the engine has no live bullish view (drift risk on capital you hold).
    const cold = rows.filter(r =>
      r.thesisStatus === "BROKEN" || r.stale || (r.score != null && r.score < 6)
    ).map(r => ({ ticker: r.ticker, actualPct: r.actualPct,
                  reason: r.thesisStatus === "BROKEN" ? "thesis broken"
                        : r.stale ? "no recent analysis"
                        : `score ${r.score}` }));

    return {
      nlv: +nlv.toFixed(2),
      cashPct: nlv > 0 ? +(cash / nlv * 100).toFixed(1) : 0,
      holdings: rows,
      gaps: { unowned, cold },
    };
  }

  const EdgeMath = { computeEdgeMap, suggestedWeight, edgeScore, winProb,
                     KELLY_FRACTION, KELLY_CAP };
  if (typeof window !== "undefined") window.EdgeMath = EdgeMath;
  if (typeof module !== "undefined" && module.exports) module.exports = EdgeMath;
})();
