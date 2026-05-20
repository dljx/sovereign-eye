/**
 * GET /api/dd/scouts
 * Returns the list of recent scout BUY discoveries:
 *   [{ ticker, score, grade, conf, thesis, key_swing, analyzed_at }, ...]
 */
export async function onRequestGet(context) {
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  try {
    const scouts = await context.env.DD_KV.get("dd:scouts", "json");
    const response = new Response(JSON.stringify(scouts || []), {
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
