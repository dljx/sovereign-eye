/**
 * GET /api/quotes?tickers=AMZN,GOOG,HPQ.V
 * Server-side quote proxy. Primary source Finnhub (US listings); falls back to
 * Yahoo Finance for symbols Finnhub doesn't cover (e.g. TSX-Venture "HPQ.V").
 * Keeps API keys out of client JavaScript.
 *
 * Response: { AMZN: { c, d, dp, pc, ... }, ... }  (Finnhub quote shape)
 */
const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/; // allow exchange suffixes like .V / .TO

async function finnhubQuote(ticker, key) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${key}`, {
      headers: { "User-Agent": "sovereign-eye" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const q = await r.json();
    return q?.c > 0 ? q : null;
  } catch { return null; }
}

// Yahoo chart API — covers non-US exchanges (TSX-V .V, TSX .TO, etc.).
// Returns the Finnhub quote shape so the frontend handles it uniformly.
async function yahooQuote(ticker) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const m = data?.chart?.result?.[0]?.meta;
    if (!m || !(m.regularMarketPrice > 0)) return null;
    const c = m.regularMarketPrice;
    const pc = m.chartPreviousClose ?? m.previousClose ?? c;
    return {
      c,
      pc,
      d:  c - pc,
      dp: pc ? ((c - pc) / pc) * 100 : 0,
      _src: "yahoo",
      _ccy: m.currency || null,
    };
  } catch { return null; }
}

// USD per 1 unit of `ccy` (e.g. CAD → ~0.73), via Yahoo FX pair.
// NB: isolate-global, NOT per-request — successes expire after a short TTL and
// failures are never stored (a cached null used to pin "FX unavailable" for the
// whole isolate lifetime, leaving non-USD quotes unconverted indefinitely).
const _fxCache = new Map();               // ccy -> { rate, ts }
const _FX_TTL_MS = 5 * 60 * 1000;
async function fxToUsd(ccy) {
  if (!ccy || ccy === "USD") return 1;
  const hit = _fxCache.get(ccy);
  if (hit && Date.now() - hit.ts < _FX_TTL_MS) return hit.rate;
  let rate = null;
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ccy}USD=X?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const p = (await r.json())?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (p > 0) rate = p;
    }
  } catch {}
  if (rate) _fxCache.set(ccy, { rate, ts: Date.now() });
  return rate;
}

export async function onRequestGet(context) {
  const key = (context.env.FINNHUB_API_KEY || "").trim();

  const url     = new URL(context.request.url);
  const raw     = url.searchParams.get("tickers") || "";
  const tickers = raw.split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => TICKER_RE.test(t))
    .slice(0, 30);

  if (!tickers.length) return Response.json({});

  const quotes = {};
  await Promise.all(tickers.map(async t => {
    // US listings (no exchange suffix) → Finnhub first.
    let q = (key && !t.includes(".")) ? await finnhubQuote(t, key) : null;
    // Anything Finnhub didn't resolve (incl. .V / .TO listings) → Yahoo.
    if (!q) q = await yahooQuote(t);
    if (q) quotes[t] = q;
  }));

  // Convert any non-USD quote into USD so it sums correctly into NLV.
  await Promise.all(Object.values(quotes).map(async q => {
    if (!q._ccy || q._ccy === "USD") return;
    const rate = await fxToUsd(q._ccy);
    if (!rate) return; // FX unavailable — leave native, better than dropping
    q.c  *= rate;
    q.pc *= rate;
    q.d  *= rate;     // dp (percent) is currency-invariant — unchanged
    q._usdFrom = q._ccy;
    q._fxRate  = rate;
    q._ccy = "USD";
  }));

  return Response.json(quotes, { headers: { "Cache-Control": "no-store" } });
}
