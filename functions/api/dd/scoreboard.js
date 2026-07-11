/**
 * GET /api/dd/scoreboard
 *
 * Signal-performance scoreboard: forward returns vs the VWRA benchmark,
 * computed by sovereign-dd's signal_analysis.py and uploaded daily via
 * POST /api/dd/upload (KV key dd:scoreboard, replaced wholesale).
 * Returns null until the first upload; the frontend falls back to seed.
 */
export async function onRequestGet(context) {
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  try {
    const scoreboard = await context.env.DD_KV.get("dd:scoreboard", "json");
    const response = new Response(JSON.stringify(scoreboard || null), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600",
        "Vary": "Authorization",
      },
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
}
