/**
 * GET /api/dd/scouts
 * Returns the list of recent scout BUY discoveries.
 *
 * PUT /api/dd/scouts
 * Replaces the dd:scouts list wholesale. Body: JSON array.
 * Auth: Basic auth (same as dashboard — handled by _middleware.js).
 * Used for manual cleanup (e.g. removing pre-algorithm-upgrade entries).
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
  await context.env.DD_KV.put("dd:scouts", JSON.stringify(sorted));

  // Purge CDN cache for this endpoint
  const cache = caches.default;
  const origin = new URL(context.request.url).origin;
  await cache.delete(new Request(`${origin}/api/dd/scouts`)).catch(() => {});

  return Response.json({ ok: true, count: sorted.length });
}
