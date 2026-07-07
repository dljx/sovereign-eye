/**
 * GET /api/scouts-history?limit=50
 *
 * Returns all-time scout discoveries from Supabase scout_history table,
 * ordered by discovered_at desc.
 */
export async function onRequestGet(context) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return Response.json([], { headers: { 'X-Supabase': 'not-configured' } });
  }

  const url   = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const qs = new URLSearchParams({
    order:  'discovered_at.desc',
    limit:  String(limit),
    select: 'ticker,score,grade,sector,path,filters,thesis,discovered_at',
  });

  const cache    = caches.default;
  const cacheKey = new Request(context.request.url);
  const cached   = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_history?${qs}`, {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return Response.json([], { status: res.status });
    const rows = await res.json();
    const fresh = Response.json(Array.isArray(rows) ? rows : [], {
      headers: { 'Cache-Control': 'public, s-maxage=900' },
    });
    context.waitUntil(cache.put(cacheKey, fresh.clone()));
    return fresh;
  } catch {
    // Honest failure — an outage must not read as "no scout history".
    return Response.json({ error: "Supabase unavailable" }, { status: 503 });
  }
}
