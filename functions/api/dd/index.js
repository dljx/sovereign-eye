/**
 * GET /api/dd/
 * Returns the master index of all analyzed tickers:
 *   { TICKER: { score, grade, conf, updated, loops, spread }, ... }
 */
export async function onRequestGet(context) {
  // Bearer callers (dd's trigger engine) self-validate per the middleware
  // contract — and MUST be rejected before the cache path, or a wrong token
  // would be served a cached copy.
  const _auth = context.request.headers.get("Authorization") || "";
  const _m = _auth.match(/^Bearer\s*(.*)$/i);
  if (_m) {
    const _t = _m[1].trim();
    if (!_t || !context.env.DD_UPLOAD_SECRET || _t !== context.env.DD_UPLOAD_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
