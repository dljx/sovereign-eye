/* global window */
// data.jsx — transforms SE_SEED + SE_CONFIG into design globals
// Loads after: positions.js, seed.js, components.jsx (normQ)
// IIFE: prevents top-level const collision when Babel evals this twice in shared scope
(function () {

const _stripHtml = s => (s || '').replace(/<[^>]+>/g, '').trim();

function _relDate(dateStr) {
  if (!dateStr) return '';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  } catch { return ''; }
}

// ── POSITIONS ──────────────────────────────────────────────────
const POSITIONS = (window.SE_CONFIG?.MY_POSITIONS || []).map(p => ({
  ...p,
  avg: p.avg ?? p.avgCost ?? 0,
}));

// ── QUOTES (seed — overwritten by live Finnhub data in app.jsx) ─
const _seedQ = window.SE_CONFIG?.SEED_QUOTES || {};
const QUOTES = {};
Object.entries(_seedQ).forEach(([tk, q]) => {
  QUOTES[tk] = {
    ...(window.normQ ? window.normQ(q) : { px: q.c || 0, dPct: q.dp || 0, dAbs: q.d || 0, vol: q.v || 0 }),
    pe: q.pe,
    eps: q.eps,
    tgt: q.target ?? q.tgt,
  };
});

// ── SYNTHESIS ──────────────────────────────────────────────────
const _intel = window.SE_SEED?.intel || {};
const SYNTHESIS = {
  catalysts: (_intel.catalysts || []).map(it => ({
    tag: it.tag, body: _stripHtml(it.text), meta: '',
  })),
  risks: (_intel.risks || []).map(it => ({
    tag: it.tag, body: _stripHtml(it.text), meta: '',
  })),
  macro: (_intel.macro || []).map(it => ({
    tag: it.tag, body: _stripHtml(it.text), meta: '',
  })),
  source: 'seed',
  age: 'seed',
};

// ── SEC FILINGS ─────────────────────────────────────────────────
const SEC_FILINGS = (window.SE_SEED?.secFilings || []).map(f => ({
  form: f.form,
  tk: f.tk,
  tldr: f.summary || f.tldr || '',
  sent: f.sentiment || f.sent || 'neutral',
  when: f.date ? _relDate(f.date) : (f.when || ''),
}));

// ── MACRO SERIES ────────────────────────────────────────────────
const _ms = window.SE_SEED?.macroSeries || {};
const MACRO_SERIES = {
  nav: _ms.portfolio || [],
  spx: _ms.spx || [],
};

// ── SCOUTS ──────────────────────────────────────────────────────
const SCOUTS = window.SE_SEED?.scouts || [];

// ── DD RESULT ───────────────────────────────────────────────────
const _ddCache = window.SE_SEED?.ddCache || {};
const _ddKeys = Object.keys(_ddCache);
// No fabricated fallback: when there's no real cached DD, leave this null so the DD
// panel shows its idle "enter a ticker" state instead of a fake STRONG BUY rating
// that could be mistaken for real analysis.
const DD_RESULT = _ddKeys.length ? _ddCache[_ddKeys[0]] : null;

// ── SPARKS (synthetic sparklines per ticker) ────────────────────
// Proxy generates on demand so it works even when positions load async from KV
function _genSpark(ticker) {
  const arr = [];
  let v = 100;
  let seed = 0;
  for (let c = 0; c < ticker.length; c++)
    seed = ((seed * 31) + ticker.charCodeAt(c)) & 0xffff;
  const freq  = 0.18 + (seed % 60) / 250;
  const freq2 = 0.11 + ((seed >> 4) % 40) / 400;
  const phase = (seed % 628) / 100;
  const vol   = 0.9 + (seed % 40) / 100;
  for (let i = 0; i < 24; i++) {
    v += Math.sin(i * freq + phase) * vol
       + Math.sin(i * freq2 + phase * 0.7) * vol * 0.5;
    arr.push(v);
  }
  return arr;
}
const _sparksCache = window.SE_CONFIG?.SPARKS || {};
const SPARKS = new Proxy(_sparksCache, {
  get(target, tk) {
    if (typeof tk !== 'string' || tk.startsWith('__')) return target[tk];
    if (!target[tk]) target[tk] = _genSpark(tk);
    return target[tk];
  },
});

// ── API HEALTH ──────────────────────────────────────────────────
const API_HEALTH = [
  { id: 'finnhub',  name: 'Finnhub',    scope: 'Quotes · Filings',  status: 'ok', latency: 145, used: 0, quota: 60000,  lastOk: 'now', endpoint: 'finnhub.io' },
  { id: 'gemini',   name: 'Gemini',     scope: 'Synthesis · DD',    status: 'ok', latency: 620, used: 0, quota: 1500,   lastOk: 'now', endpoint: 'generativelanguage.googleapis.com' },
  { id: 'tavily',   name: 'Tavily',     scope: 'News wire',         status: 'ok', latency: 820, used: 0, quota: 1000,   lastOk: 'now', endpoint: 'api.tavily.com' },
  { id: 'gh',       name: 'GH Actions', scope: 'DD agent runs',     status: 'ok', latency: 340, used: 0, quota: 2000,   lastOk: 'now', endpoint: 'api.github.com' },
  { id: 'cf-kv',    name: 'CF KV',      scope: 'Portfolio store',   status: 'ok', latency: 28,  used: 0, quota: 100000, lastOk: 'now', endpoint: 'kv.cloudflare.com' },
  { id: 'sec',      name: 'SEC EDGAR',  scope: 'Filings',           status: 'ok', latency: 480, used: 0, quota: 0,      lastOk: 'now', endpoint: 'data.sec.gov' },
];

// ── COMPUTED TOTALS ─────────────────────────────────────────────
function computeTotals(positions, quotes) {
  const pos = positions || POSITIONS;
  const qts = quotes || QUOTES;
  let nlv = 0, cost = 0, dayPnl = 0;
  pos.forEach(p => {
    const q = qts[p.ticker]; if (!q) return;
    const mv = (q.px || 0) * p.qty;
    nlv += mv;
    cost += p.avg * p.qty;
    dayPnl += (q.dAbs || 0) * p.qty;
  });
  const unreal = nlv - cost;
  return {
    nlv, cost, unreal,
    unrealPct: cost ? (unreal / cost) * 100 : 0,
    dayPnl,
    dayPnlPct: (nlv - dayPnl) > 0 ? (dayPnl / (nlv - dayPnl)) * 100 : 0,
    count: pos.length,
  };
}

// ── DD FOR TICKER ───────────────────────────────────────────────
function ddForTicker(tk) {
  if (window.DD_RESULT && window.DD_RESULT.ticker === tk) return window.DD_RESULT;
  const scout = (window.SCOUTS || []).find(s => s.tk === tk);
  if (!scout) return null;
  const bull = scout.score >= 8.0;
  return {
    ticker: scout.tk, score: scout.score, grade: scout.grade,
    confidence: scout.score >= 8.0 ? 'HIGH' : scout.score >= 7.0 ? 'MEDIUM' : 'LOW',
    asOf: 'Scouted',
    thesis: `${scout.rationale} Screened via Path ${scout.valPath}: ${scout.filters.join(' · ')}.`,
    swing: `If ${scout.filters[0]} sustains through next two quarters, multiple re-rates toward sector leaders.`,
    dissent: bull ? 'TechAnalysis flags momentum extension; wait for pullback if sizing up.' : 'Macro neutral; entry timing matters.',
    agents: [
      { name: 'Valuation',       vote: bull ? 'BULL' : 'NEUTRAL', rationale: `Multiple supports thesis given ${scout.filters.find(f => f.includes('GM')) || 'strong margins'}.` },
      { name: 'Macro',           vote: 'NEUTRAL', rationale: `${scout.sector} sector pace constructive but variable.` },
      { name: 'TechAnalysis',    vote: bull ? 'BULL' : 'NEUTRAL', rationale: 'Setup constructive on weekly. Watch volume on breakout.' },
      { name: 'FundForensics',   vote: 'BULL',    rationale: `${scout.filters[0]} corroborated by filings; no quality flags.` },
      { name: 'MarketStructure', vote: bull ? 'BULL' : 'NEUTRAL', rationale: 'Crowding low. No anomalies in OI.' },
    ],
    fromScout: true,
  };
}

  Object.assign(window, {
    POSITIONS, QUOTES, SYNTHESIS,
    SEC_FILINGS, DD_RESULT, SCOUTS, MACRO_SERIES, SPARKS,
    computeTotals, ddForTicker, API_HEALTH,
  });
})();
