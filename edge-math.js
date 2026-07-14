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

  // Aggregate same-ticker position rows across brokers — a name held at two
  // brokers is ONE bet (found live 2026-07-15: ANET at IBKR + Tiger). Per-
  // account rows split its weight, understating concentration for the median
  // test, the Kelly comparison, and HHI/effective-bets.
  function aggregateByTicker(positions) {
    let cash = 0;
    const byTicker = new Map();
    for (const p of positions || []) {
      const ticker = String(p && p.ticker || "").toUpperCase();
      if (!ticker) continue;
      if (ticker === "USD") { cash += Number(p.avg) || 0; continue; }
      const cur = byTicker.get(ticker) || { ticker, qty: 0, brokers: [] };
      cur.qty += Number(p.qty) || 0;
      const b = String(p.broker || "");
      if (b && cur.brokers.indexOf(b) === -1) cur.brokers.push(b);
      byTicker.set(ticker, cur);
    }
    return { cash, equities: [...byTicker.values()] };
  }

  // positions: [{ticker,qty,avg,broker}] (+ a USD cash row). quotes: {T:{c}}.
  // index: {T:{score,rr,fv,sizePct,sector,beta,updated}}. theses: {T:{status,adherence}}.
  // confirmCards: [{ticker,score,verdict,fair_value_composite,price}] (scout/gems boards).
  function computeEdgeMap(positions, quotes, index, theses, confirmCards, opts) {
    const now = (opts && opts.now) || Date.now();
    index = index || {}; theses = theses || {}; quotes = quotes || {};
    const held = new Set();
    const aggd = aggregateByTicker(positions);
    let cash = aggd.cash, nlv = aggd.cash;

    const rows = [];
    for (const p of aggd.equities) {
      const ticker = p.ticker;
      held.add(ticker);
      const q = quotes[ticker] || {};
      const px = Number(q.c) || 0;
      const mv = px * p.qty;
      nlv += mv;
      const ix = index[ticker] || null;
      const th = theses[ticker] || {};
      rows.push({ ticker, broker: p.brokers.join("+"), qty: p.qty, px, mv,
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

  // True-exposure: sector/HHI/portfolio-beta so concentration is DELIBERATE,
  // not a diversification nag. Reveals when N names are really 1 bet (low
  // effective-position count) and your true factor exposure. Sector/beta come
  // from dd:index (sector is empty on raw position rows). Correlation matrix
  // deliberately deferred (noisiest, most expensive).
  function computeExposure(positions, quotes, index) {
    index = index || {}; quotes = quotes || {};
    const aggd = aggregateByTicker(positions);   // per NAME, not per account row
    const cash = aggd.cash;
    let nlv = cash;
    const eq = [];
    for (const p of aggd.equities) {
      const t = p.ticker;
      const mv = (Number((quotes[t] || {}).c) || 0) * p.qty;
      nlv += mv;
      const ix = index[t] || {};
      eq.push({ ticker: t, mv,
                sector: ix.sector || "Unclassified",
                beta: Number.isFinite(Number(ix.beta)) ? Number(ix.beta) : null });
    }
    if (nlv <= 0 || !eq.length) return null;

    const equityNlv = nlv - cash;
    const sectorAgg = {};
    let sumSq = 0, betaW = 0, betaCov = 0, maxW = 0;
    for (const e of eq) {
      const w = e.mv / nlv;                       // fraction of total NLV (concentration vs whole book)
      const we = equityNlv > 0 ? e.mv / equityNlv : 0; // fraction of EQUITY (effective-bets)
      sumSq += we * we;                           // HHI over equity → 1/HHI = effective # of equity bets
      maxW = Math.max(maxW, w);
      sectorAgg[e.sector] = (sectorAgg[e.sector] || 0) + w;
      if (e.beta != null) { betaW += w * e.beta; betaCov += w; }
    }
    const sectors = Object.entries(sectorAgg)
      .map(([sector, w]) => ({ sector, pct: +(w * 100).toFixed(1) }))
      .sort((a, b) => b.pct - a.pct);
    const top5 = [...eq].sort((a, b) => b.mv - a.mv).slice(0, 5)
      .reduce((s, e) => s + e.mv, 0) / nlv;
    return {
      nlv: +nlv.toFixed(2),
      cashPct: +(cash / nlv * 100).toFixed(1),
      sectors,
      hhi: +sumSq.toFixed(4),
      effectiveBets: +(1 / sumSq).toFixed(1),   // 1/HHI: how many independent bets it really is
      top5Pct: +(top5 * 100).toFixed(1),
      singleMaxPct: +(maxW * 100).toFixed(1),
      // Σ(weight×beta) over covered holdings, renormalized by covered weight so
      // partial coverage isn't understated. Labelled vs-US-market (yfinance).
      beta: betaCov > 0 ? +(betaW / betaCov).toFixed(2) : null,
      betaCoverPct: +(betaCov * 100).toFixed(0),
    };
  }

  // Return-correlation view — the RISK answer to "do these draw down together?".
  // Realized co-movement from price history (NOT business-model embeddings:
  // semantic similarity is a leaky proxy for co-movement and misses shared
  // factor/macro/sentiment exposure, which is what actually drives correlated
  // drawdowns). Collapses to the effective number of independent bets via
  // N²/Σρ²  (closed form: for a correlation matrix Σλ² = Σ ρᵢⱼ²).
  //
  // closesBySymbol: { SYM: { "YYYY-MM-DD": close } }. weights optional (for
  // cluster weight only). Returns null / {insufficient} when history is thin.
  function correlationView(closesBySymbol, weights) {
    const symbols = Object.keys(closesBySymbol || {}).filter(s => s !== "USD");
    if (symbols.length < 2) return null;

    // Common trading days across ALL symbols (correlation needs aligned dates).
    let common = null;
    for (const s of symbols) {
      const days = new Set(Object.keys(closesBySymbol[s] || {}));
      common = common == null ? days : new Set([...common].filter(d => days.has(d)));
    }
    const dates = [...(common || [])].sort();
    if (dates.length < 30) return { insufficient: true, days: dates.length, symbols };

    // Daily returns per symbol over the common calendar.
    const rets = {};
    for (const s of symbols) {
      const c = closesBySymbol[s];
      const r = [];
      for (let i = 1; i < dates.length; i++) {
        const p0 = c[dates[i - 1]], p1 = c[dates[i]];
        r.push(p0 > 0 ? p1 / p0 - 1 : 0);
      }
      rets[s] = r;
    }

    const n = symbols.length;
    const corr = (a, b) => {
      const m = a.length;
      let ma = 0, mb = 0;
      for (let i = 0; i < m; i++) { ma += a[i]; mb += b[i]; }
      ma /= m; mb /= m;
      let cov = 0, va = 0, vb = 0;
      for (let i = 0; i < m; i++) {
        const da = a[i] - ma, db = b[i] - mb;
        cov += da * db; va += da * da; vb += db * db;
      }
      return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
    };

    const matrix = [];
    let sumSq = 0, offSum = 0, offN = 0;
    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        const c = i === j ? 1 : corr(rets[symbols[i]], rets[symbols[j]]);
        matrix[i][j] = +c.toFixed(3);
        sumSq += c * c;
        if (i < j) { offSum += c; offN++; }
      }
    }

    // Grouping via union-find at a pairwise-ρ threshold. Returns member lists
    // including singletons — a name that co-moves with nothing IS its own bet.
    const wmap = weights || {};
    const groupAt = (thresh) => {
      const parent = symbols.map((_, i) => i);
      const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (matrix[i][j] >= thresh) parent[find(i)] = find(j);
      }
      const byRoot = {};
      for (let i = 0; i < n; i++) (byRoot[find(i)] ||= []).push(i);
      return Object.values(byRoot).map(idxs => {
        let rSum = 0, rN = 0;
        for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) {
          rSum += matrix[idxs[a]][idxs[b]]; rN++;
        }
        const members = idxs.map(i => symbols[i]);
        return {
          members,
          weightPct: +members.reduce((s, t) => s + (Number(wmap[t]) || 0), 0).toFixed(1),
          // Mean pairwise ρ WITHIN the group (null for singletons) — how tightly
          // this "one bet" actually moves as one.
          avgRho: rN ? +(rSum / rN).toFixed(2) : null,
        };
      });
    };

    // Tight clusters (ρ≥0.7): the "effectively ONE bet" warning.
    const clusters = groupAt(0.7).filter(g => g.members.length >= 2)
      .sort((a, b) => b.members.length - a.members.length);
    // Bet decomposition (ρ≥0.5, singletons included): the human-readable
    // answer to "what ARE my N bets?" — softer threshold so related names
    // (same factor/sector exposure) read as one bet even before they hit the
    // tight-cluster bar. Sorted by capital at risk.
    const groups = groupAt(0.5).sort((a, b) => b.weightPct - a.weightPct);

    return {
      symbols, matrix,
      days: dates.length,
      avgCorr: offN ? +(offSum / offN).toFixed(3) : null,
      // 1 (one bet in disguise) .. N (genuinely independent). Calm-market upper
      // bound — correlations rise toward 1 in a real drawdown.
      effectiveBets: +(n * n / sumSq).toFixed(1),
      clusters,
      groups,
    };
  }

  const EdgeMath = { computeEdgeMap, computeExposure, correlationView, suggestedWeight,
                     edgeScore, winProb, KELLY_FRACTION, KELLY_CAP };
  if (typeof window !== "undefined") window.EdgeMath = EdgeMath;
  if (typeof module !== "undefined" && module.exports) module.exports = EdgeMath;
})();
