/**
 * GET /api/dd/watchlist
 * Returns the "Under Review" list — BUYs that crossed the score threshold but
 * failed the second-round confirmation gate (deterministic checks + red-team).
 * Each entry carries a `verification` block with the reason it was held back.
 *
 * PUT /api/dd/watchlist
 * Replaces the dd:watchlist list wholesale. Body: JSON array.
 * Auth: Basic auth (same as dashboard — handled by _middleware.js). Manual cleanup.
 * Mirrors /api/dd/scouts.
 */
export async function onRequestGet(context) {
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  try {
    const watchlist = await context.env.DD_KV.get("dd:watchlist", "json");
    const response = new Response(JSON.stringify(watchlist || []), {
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

export async function onRequestPut(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: "Body must be a JSON array" }, { status: 400 });
  }

  const sorted = [...body].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  await context.env.DD_KV.put("dd:watchlist", JSON.stringify(sorted));

  const cache = caches.default;
  const origin = new URL(context.request.url).origin;
  await cache.delete(new Request(`${origin}/api/dd/watchlist`)).catch(() => {});

  return Response.json({ ok: true, count: sorted.length });
}
