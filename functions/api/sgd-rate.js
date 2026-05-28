/**
 * GET /api/sgd-rate
 * Proxies Frankfurter FX API server-side to avoid CORS issues.
 * Returns { rate: number } — USD/SGD.
 * Cached at the edge for 6 hours.
 */
export async function onRequestGet(context) {
  const cache    = caches.default;
  const cacheKey = new Request('https://sovereign-eye-sgd-rate/v1');
  const cached   = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD');
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.SGD;
    if (!rate || typeof rate !== 'number') throw new Error('bad payload');

    const fresh = Response.json({ rate }, {
      headers: { 'Cache-Control': 'public, s-maxage=21600' },
    });
    context.waitUntil(cache.put(cacheKey, fresh.clone()));
    return fresh;
  } catch {
    return Response.json({ rate: 1.35 }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    });
  }
}
