/**
 * GET /api/sparks?tickers=AMZN,MSFT,...
 *
 * Returns ~30 daily closes per ticker, normalized (oldest = 100).
 * KV-cached 30 minutes.
 */

const CACHE_KEY     = 'sparks:v1';
const CACHE_TTL_SEC = 30 * 60;
const DAYS          = 30;

export async function onRequestGet(context) {
  const kv  = context.env.DD_KV;
  const key = (context.env.FINNHUB_API_KEY || '').trim();
  if (!key) return Response.json({});

  const url     = new URL(context.request.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase())
    .filter(t => /^[A-Z]{1,10}$/.test(t)).slice(0, 15);
  if (!tickers.length) return Response.json({});

  // Check cache — return if fresh
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY, 'json');
      if (cached && typeof cached === 'object') {
        const allPresent = tickers.every(t => Array.isArray(cached[t]));
        if (allPresent) {
          const out = {};
          tickers.forEach(t => { out[t] = cached[t]; });
          return Response.json(out, { headers: { 'X-Cache': 'HIT' } });
        }
      }
    } catch (_) {}
  }

  // Fetch daily candles: 60 calendar days → ~30 trading days
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 60 * 86400;

  const results = await Promise.all(
    tickers.map(sym =>
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${now}&token=${key}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const fresh = {};
  tickers.forEach((sym, i) => {
    const r = results[i];
    if (r?.s === 'ok' && Array.isArray(r.c) && r.c.length >= 2) {
      const closes = r.c.slice(-DAYS);
      const base   = closes[0] || 1;
      fresh[sym] = closes.map(c => +((c / base) * 100).toFixed(2));
    }
  });

  if (kv && Object.keys(fresh).length) {
    try {
      const existing = (await kv.get(CACHE_KEY, 'json')) || {};
      await kv.put(CACHE_KEY, JSON.stringify({ ...existing, ...fresh }), {
        expirationTtl: CACHE_TTL_SEC,
      });
    } catch (_) {}
  }

  return Response.json(fresh);
}
