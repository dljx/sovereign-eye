/**
 * GET /api/sparks?tickers=AMZN,MSFT,...
 *
 * Returns ~30 daily closes per ticker, normalized (oldest = 100).
 * KV-cached 30 minutes.
 *
 * 2026-07-11: source switched Finnhub candle → Yahoo chart. /stock/candle is
 * premium-gated on the Finnhub free tier (403 → the panel silently served
 * seed data forever), and a partial cache miss used to refetch EVERY ticker
 * instead of just the missing ones (audit P2). Yahoo chart is the same free
 * path quotes.js/nav-history.js already rely on.
 */

const CACHE_KEY     = 'sparks:v1';
const CACHE_TTL_SEC = 30 * 60;
const DAYS          = 30;

async function yahooCloses(sym) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) { r.body?.cancel(); return null; }
    const closes = (await r.json())?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return null;
    const clean = closes.filter(c => c > 0);
    return clean.length >= 2 ? clean : null;
  } catch { return null; }
}

export async function onRequestGet(context) {
  const kv = context.env.DD_KV;

  const url     = new URL(context.request.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase())
    .filter(t => /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(t)).slice(0, 15); // allow BRK.B / HPQ.V
  if (!tickers.length) return Response.json({});

  // Serve cached series and fetch ONLY the missing tickers.
  let cached = {};
  if (kv) {
    try {
      const raw = await kv.get(CACHE_KEY, 'json');
      if (raw && typeof raw === 'object') cached = raw;
    } catch (_) {}
  }
  const out = {};
  const missing = [];
  for (const t of tickers) {
    if (Array.isArray(cached[t])) out[t] = cached[t];
    else missing.push(t);
  }
  if (!missing.length) return Response.json(out, { headers: { 'X-Cache': 'HIT' } });

  const results = await Promise.all(missing.map(yahooCloses));
  const fresh = {};
  missing.forEach((sym, i) => {
    const closes = results[i];
    if (closes) {
      const tail = closes.slice(-DAYS);
      const base = tail[0] || 1;
      fresh[sym] = tail.map(c => +((c / base) * 100).toFixed(2));
      out[sym] = fresh[sym];
    }
  });

  if (kv && Object.keys(fresh).length) {
    try {
      await kv.put(CACHE_KEY, JSON.stringify({ ...cached, ...fresh }), {
        expirationTtl: CACHE_TTL_SEC,
      });
    } catch (_) {}
  }

  return Response.json(out);
}
