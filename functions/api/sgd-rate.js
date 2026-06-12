/**
 * GET /api/sgd-rate
 * Proxies Frankfurter FX API server-side to avoid CORS issues.
 * Returns { rate: number } — USD/SGD.
 * Cached at the edge for 6 hours. Last-good rate stored in KV as fallback.
 */
const KV_LAST_GOOD = 'sgd:rate:last_good';

export async function onRequestGet(context) {
  const cache    = caches.default;
  const cacheKey = new Request('https://sovereign-eye-sgd-rate/v1');
  const cached   = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD',
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.SGD;
    if (!rate || typeof rate !== 'number') throw new Error('bad payload');

    if (context.env.DD_KV) {
      context.waitUntil(context.env.DD_KV.put(KV_LAST_GOOD, String(rate), { expirationTtl: 7 * 86400 }));
    }

    const fresh = Response.json({ rate }, {
      headers: { 'Cache-Control': 'public, s-maxage=21600' },
    });
    context.waitUntil(cache.put(cacheKey, fresh.clone()));
    return fresh;
  } catch {
    let fallbackRate = 1.35;
    if (context.env.DD_KV) {
      try {
        const stored = await context.env.DD_KV.get(KV_LAST_GOOD);
        if (stored) fallbackRate = parseFloat(stored) || 1.35;
      } catch {}
    }
    return Response.json({ rate: fallbackRate }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    });
  }
}
