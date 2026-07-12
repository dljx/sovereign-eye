/**
 * GET /api/portfolio/correlation
 *
 * Serves ~1y of daily closes for each equity holding so the dashboard can
 * compute the return-correlation view (window.EdgeMath.correlationView) — the
 * RISK answer to "do these draw down together?". Realized co-movement from
 * price history, deliberately NOT business-model embeddings (semantic
 * similarity is a leaky proxy that misses shared factor/macro/sentiment
 * exposure). The heavy math lives in the shared, unit-tested edge-math.js;
 * this endpoint only gathers the aligned price history it needs.
 *
 * Dashboard-only (Basic auth via middleware — not in BEARER_PATHS). Edge-cached
 * 12h: correlation is slow-moving and the fan-out is one Yahoo call per holding.
 *
 * Response: { asOf, closes: { "<TICKER>": { "YYYY-MM-DD": close, ... } } }
 */
import { drain } from "../_util.js";

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

async function yahooDaily(symbol) {
  // ~14 months of daily closes (enough for a stable correlation estimate).
  const period2 = (Math.floor(Date.now() / 86400000) + 1) * 86400;
  const period1 = period2 - 430 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
              `?interval=1d&period1=${period1}&period2=${period2}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" },
                                 signal: AbortSignal.timeout(8000) });
    if (!r.ok) { drain(r); return null; }
    const res = (await r.json())?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const closes = res?.indicators?.quote?.[0]?.close || [];
    const out = {};
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] > 0) out[new Date(ts[i] * 1000).toISOString().slice(0, 10)] = +closes[i].toFixed(4);
    }
    return Object.keys(out).length >= 30 ? out : null;
  } catch { return null; }
}

export async function onRequestGet(context) {
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  let positions = [];
  try {
    const raw = await context.env.DD_KV.get("positions:daryl", "json");
    if (Array.isArray(raw)) positions = raw;
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
  const tickers = [...new Set(
    positions.map(p => String(p?.ticker || "").toUpperCase())
      .filter(t => t && t !== "USD" && TICKER_RE.test(t))
  )].slice(0, 30);

  const results = await Promise.all(tickers.map(yahooDaily));
  const closes = {};
  tickers.forEach((t, i) => { if (results[i]) closes[t] = results[i]; });

  const response = Response.json(
    { asOf: new Date().toISOString().slice(0, 10), closes },
    { headers: { "Cache-Control": "public, s-maxage=43200", "Vary": "Authorization" } }
  );
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
