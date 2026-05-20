/**
 * GET /api/dd/:ticker
 * Returns the latest full sovereign-dd analysis for a ticker from Cloudflare KV.
 */
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export async function onRequestGet(context) {
  const ticker = (context.params.ticker || "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return Response.json({ error: "invalid ticker" }, { status: 400 });
  }

  // Workers Cache API — keyed by URL only so auth header doesn't prevent caching.
  // Auth already validated by middleware before reaching this handler.
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  try {
    const data = await context.env.DD_KV.get(`dd:${ticker}`, "json");
    if (!data) {
      return Response.json({ error: "not found", ticker }, { status: 404 });
    }
    const response = new Response(JSON.stringify(data), {
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
