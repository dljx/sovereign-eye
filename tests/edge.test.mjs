// Edge & Exposure math — pure-function tests (mirrors fire.test.mjs's require()).
// Run: node tests/edge.test.mjs
//
// Locks the 2026-07-12 contract: rank + earned/drift classification + direction
// are load-bearing; the ¼-Kelly % is conservative & capped.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const EM = require(join(__dirname, "..", "edge-math.js"));

let failed = 0;
const check = (n, c, d = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  [${d}]`}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ── winProb: conservative, capped ──────────────────────────────────────────────
check("winProb(7) ~ 0.51", near(EM.winProb(7), 0.51, 1e-9), EM.winProb(7));
check("winProb(10) = 0.675 (never > 0.72 cap)", near(EM.winProb(10), 0.675) && EM.winProb(10) <= 0.72, EM.winProb(10));
check("winProb floored at 0.40", EM.winProb(3) === 0.40);

// ── suggestedWeight: quarter-Kelly, capped, thesis-aware ───────────────────────
{
  // score 8 (p≈0.565), rr 3 → f=(3*0.565−0.435)/3=0.42; ¼=0.105; under 0.15 cap
  const w = EM.suggestedWeight(8, 3, "INTACT");
  check("¼-Kelly reasonable magnitude", w > 0.08 && w < 0.13, `${w}`);
  check("capped at 15%", EM.suggestedWeight(10, 20, "INTACT") === 0.15);
  check("broken thesis → 0", EM.suggestedWeight(9, 3, "BROKEN") === 0);
  check("no rr → null (rank-only)", EM.suggestedWeight(8, null, "INTACT") === null);
  check("negative-edge Kelly → 0", EM.suggestedWeight(5.5, 1.1, "INTACT") === 0);
  const strained = EM.suggestedWeight(8, 3, "STRAINED");
  const intact = EM.suggestedWeight(8, 3, "INTACT");
  check("strained shrinks the suggestion", strained < intact, `${strained} vs ${intact}`);
}

// ── edgeScore: thesis-adjusted ─────────────────────────────────────────────────
check("edge = score when INTACT", EM.edgeScore(8, "INTACT") === 8);
check("broken halves-ish edge", EM.edgeScore(8, "BROKEN") === 3.2);
check("absent thesis mild discount", EM.edgeScore(8, null) === 7.36);

// ── computeEdgeMap: classification + gaps ──────────────────────────────────────
{
  const positions = [
    { ticker: "AAA", qty: 100, avg: 10, broker: "IBKR" }, // big, high conv, intact → EARNED
    { ticker: "BBB", qty: 100, avg: 10, broker: "IBKR" }, // big, broken thesis → DRIFT
    { ticker: "CCC", qty: 1, avg: 10, broker: "Tiger" },  // tiny, high conv → UNDERWEIGHT
    { ticker: "USD", qty: 1, avg: 500, broker: "Tiger" }, // cash
  ];
  const quotes = { AAA: { c: 50 }, BBB: { c: 50 }, CCC: { c: 50 } }; // AAA/BBB mv=5000, CCC mv=50
  const nowIso = new Date().toISOString();
  const index = {
    AAA: { score: 8.5, rr: 3, fv: 70, updated: nowIso },
    BBB: { score: 8.0, rr: 3, fv: 70, updated: nowIso },
    CCC: { score: 8.0, rr: 3, fv: 70, updated: nowIso },
  };
  const theses = { AAA: { status: "INTACT" }, BBB: { status: "BROKEN" }, CCC: { status: "INTACT" } };
  const cards = [
    { ticker: "ZZZ", score: 8.9, verdict: "CONFIRM", fair_value_composite: 40, price: 30 }, // unowned
    { ticker: "AAA", score: 8.5, verdict: "CONFIRM" }, // owned → not a gap
    { ticker: "WWW", score: 7.2, verdict: "DOWNGRADE" }, // not a CONFIRM → ignored
  ];
  const out = EM.computeEdgeMap(positions, quotes, index, theses, cards, { now: Date.now() });
  const by = Object.fromEntries(out.holdings.map(h => [h.ticker, h]));
  check("nlv sums equity + cash", out.nlv === 5000 + 5000 + 50 + 500, `${out.nlv}`);
  check("cash % computed", out.cashPct === +(500 / out.nlv * 100).toFixed(1), `${out.cashPct}`);
  check("AAA classified EARNED", by.AAA.klass === "EARNED", by.AAA.klass);
  check("BBB (broken) classified DRIFT", by.BBB.klass === "DRIFT", by.BBB.klass);
  check("CCC (tiny, high edge) UNDERWEIGHT", by.CCC.klass === "UNDERWEIGHT", by.CCC.klass);
  check("BBB suggested weight 0 (broken)", by.BBB.suggestedPct === 0, `${by.BBB.suggestedPct}`);
  check("rows ranked by edge (AAA top: 8.5 intact)", out.holdings[0].ticker === "AAA");
  check("unowned CONFIRM surfaced", out.gaps.unowned.length === 1 && out.gaps.unowned[0].ticker === "ZZZ");
  check("owned CONFIRM not a gap", !out.gaps.unowned.some(u => u.ticker === "AAA"));
  check("cold list flags the broken holding", out.gaps.cold.some(c => c.ticker === "BBB" && c.reason === "thesis broken"));
}

// ── stale index entry → treated as no live view ───────────────────────────────
{
  const positions = [{ ticker: "OLD", qty: 100, avg: 10, broker: "IBKR" }];
  const quotes = { OLD: { c: 50 } };
  const oldIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const index = { OLD: { score: 9, rr: 3, updated: oldIso } };
  const out = EM.computeEdgeMap(positions, quotes, index, {}, [], { now: Date.now() });
  check("stale high-score holding is DRIFT (no live view)", out.holdings[0].klass === "DRIFT", out.holdings[0].klass);
  check("stale holding on cold list", out.gaps.cold.some(c => c.ticker === "OLD" && c.reason === "no recent analysis"));
}

// ── computeExposure: HHI / effective-bets / portfolio beta ─────────────────────
{
  const positions = [
    { ticker: "AAA", qty: 100, avg: 10 }, // mv 4000
    { ticker: "BBB", qty: 100, avg: 10 }, // mv 4000 (same sector as AAA → hidden concentration)
    { ticker: "CCC", qty: 100, avg: 10 }, // mv 2000
    { ticker: "USD", qty: 1, avg: 1000 },
  ];
  const quotes = { AAA: { c: 40 }, BBB: { c: 40 }, CCC: { c: 20 } };
  const index = {
    AAA: { sector: "Technology", beta: 1.5 },
    BBB: { sector: "Technology", beta: 1.3 },
    CCC: { sector: "Energy", beta: 0.8 },
  };
  const ex = EM.computeExposure(positions, quotes, index);
  // nlv = 4000+4000+2000+1000 = 11000; weights .3636/.3636/.1818 (+cash .0909)
  // sector aggregation reveals hidden concentration (2 Tech names = 73% one theme);
  // effective-bets measures weight dispersion (over EQUITY): .40/.40/.20 → ~2.78 < 3
  check("sectors aggregated + sorted (Tech ~73%)", ex.sectors[0].sector === "Technology" && ex.sectors[0].pct > 70,
        JSON.stringify(ex.sectors));
  check("effective-bets over equity < position count", ex.effectiveBets < 3 && ex.effectiveBets > 2.5, `${ex.effectiveBets}`);
  check("portfolio beta = weighted avg", Math.abs(ex.beta - ((0.3636*1.5 + 0.3636*1.3 + 0.1818*0.8) / (0.3636+0.3636+0.1818))) < 0.02, `${ex.beta}`);
  check("beta coverage excludes cash", ex.betaCoverPct === 91, `${ex.betaCoverPct}`);
  check("cash % reported", ex.cashPct > 9 && ex.cashPct < 10, `${ex.cashPct}`);
  check("empty positions -> null", EM.computeExposure([], {}, {}) === null);
}

// ── correlationView: effective bets / clusters ─────────────────────────────────
{
  // Build 40 days. A & B move together (same driver), C moves opposite/independent.
  const dates = Array.from({ length: 40 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`);
  const mk = (base, fn) => { const o = {}; let p = base; dates.forEach((d, i) => { p *= (1 + fn(i)); o[d] = +p.toFixed(4); }); return o; };
  const wave = i => Math.sin(i / 3) * 0.02;       // shared driver (A & B)
  const A = mk(100, i => wave(i) + 0.001);
  const B = mk(50, i => wave(i) * 0.98 + 0.0005); // ~ perfectly correlated with A
  const C = mk(80, i => Math.sin(i / 1.7 + 2) * 0.02 + 0.0008); // independent driver
  const cv = EM.correlationView({ A, B, C }, { A: 20, B: 20, C: 10 });
  check("A/B strongly correlated (≥0.9)", cv.matrix[0][1] >= 0.9, `${cv.matrix[0][1]}`);
  check("A/C ~ independent (|ρ|<0.5)", Math.abs(cv.matrix[0][2]) < 0.5, `${cv.matrix[0][2]}`);
  check("effective bets ~2 (A,B one bet; C another)", cv.effectiveBets > 1.6 && cv.effectiveBets < 2.4, `${cv.effectiveBets}`);
  check("A+B clustered with summed weight", cv.clusters.length === 1
        && cv.clusters[0].members.sort().join() === "A,B" && cv.clusters[0].weightPct === 40,
        JSON.stringify(cv.clusters));
  check("avgCorr reported", typeof cv.avgCorr === "number");
}
{
  // Thin history → insufficient, not a noisy number.
  const short = { X: { "2026-05-01": 1, "2026-05-02": 1.1 }, Y: { "2026-05-01": 1, "2026-05-02": 0.9 } };
  const cv = EM.correlationView(short);
  check("thin history -> insufficient flag", cv.insufficient === true, JSON.stringify(cv));
  check("single symbol -> null", EM.correlationView({ A: { "2026-05-01": 1 } }) === null);
}

// ── multi-broker aggregation (2026-07-15) ──────────────────────────────────────
// A name held at TWO brokers is ONE bet (live: ANET at IBKR + Tiger). Per-
// account rows split its weight — understating concentration for the median
// test, the Kelly comparison, and HHI/effective-bets — and duplicate React
// keys upstream rendered a phantom empty row.
{
  const positions = [
    { ticker: "ANET", qty: 80, avg: 143, broker: "IBKR" },
    { ticker: "ANET", qty: 64, avg: 160, broker: "Tiger" },
    { ticker: "GOOG", qty: 10, avg: 380, broker: "Tiger" },
    { ticker: "USD",  qty: 1,  avg: 1000, broker: "Tiger" },
  ];
  const quotes = { ANET: { c: 100 }, GOOG: { c: 100 } }; // ANET mv=14400, GOOG mv=1000
  const nowIso = new Date().toISOString();
  const index = { ANET: { score: 8, rr: 3, updated: nowIso }, GOOG: { score: 8, rr: 3, updated: nowIso } };
  const m = EM.computeEdgeMap(positions, quotes, index, {}, []);
  check("aggregated: one row per NAME", m.holdings.length === 2, `${m.holdings.length}`);
  const anet = m.holdings.find(h => h.ticker === "ANET");
  check("qty summed across brokers", anet.qty === 144, `${anet.qty}`);
  check("combined weight (14400/16400)", near(anet.actualPct, 87.8, 0.1), `${anet.actualPct}`);
  check("brokers joined for display", anet.broker === "IBKR+Tiger", anet.broker);
  check("nlv counts each lot once", near(m.nlv, 16400, 0.01), `${m.nlv}`);

  const ex = EM.computeExposure(positions, quotes, index);
  // Equity HHI on COMBINED weights: (14400/15400)^2+(1000/15400)^2 -> 1/HHI ~ 1.14,
  // not the ~2 that per-account rows would fake.
  check("exposure effectiveBets on combined weights", ex.effectiveBets < 1.3, `${ex.effectiveBets}`);
  check("exposure singleMax reflects the combined name", ex.singleMaxPct > 80, `${ex.singleMaxPct}`);
}

// ── correlationView.groups: the bet decomposition (2026-07-15) ─────────────────
{
  const dates = Array.from({ length: 40 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`);
  const mk = (base, fn) => { const o = {}; let p = base; dates.forEach((d, i) => { p *= (1 + fn(i)); o[d] = +p.toFixed(4); }); return o; };
  const wave = i => Math.sin(i / 3) * 0.02;
  const A = mk(100, i => wave(i) + 0.001);
  const B = mk(50, i => wave(i) * 0.98 + 0.0005);
  const C = mk(80, i => Math.sin(i / 1.7 + 2) * 0.02 + 0.0008);
  const cv = EM.correlationView({ A, B, C }, { A: 20, B: 20, C: 10 });
  check("groups cover every symbol incl. singletons",
        cv.groups.reduce((s, g) => s + g.members.length, 0) === 3, JSON.stringify(cv.groups));
  const ab = cv.groups.find(g => g.members.length === 2);
  check("A+B grouped as one bet with avg intra-rho", ab && ab.members.sort().join() === "A,B"
        && ab.avgRho >= 0.9, JSON.stringify(ab));
  const solo = cv.groups.find(g => g.members.length === 1);
  check("singleton bet has null avg-rho (nothing to correlate within)", solo && solo.avgRho === null,
        JSON.stringify(solo));
  check("groups sorted by capital at risk", cv.groups[0].weightPct >= cv.groups[cv.groups.length - 1].weightPct);
}

console.log(failed === 0 ? "\nALL EDGE TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
