/**
 * GET /api/dd/
 * Returns the master index of all analyzed tickers:
 *   { TICKER: { score, grade, conf, updated, loops, spread }, ... }
 */
export async function onRequestGet(context) {
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  try {
    const index = await context.env.DD_KV.get("dd:index", "json");
    const response = new Response(JSON.stringify(index || {}), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600",
      },
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
}
