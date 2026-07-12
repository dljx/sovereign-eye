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

console.log(failed === 0 ? "\nALL EDGE TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
