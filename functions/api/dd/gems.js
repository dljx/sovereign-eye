/**
 * GET /api/dd/gems
 * Returns the list of recent gems BUY discoveries (the gems screener pipeline).
 *
 * PUT /api/dd/gems
 * Replaces the dd:gems list wholesale. Body: JSON array.
 * Auth: Basic auth (same as dashboard — handled by _middleware.js).
 * Used for manual cleanup. Mirrors /api/dd/scouts.
 */
export async function onRequestGet(context) {
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  try {
    const gems = await context.env.DD_KV.get("dd:gems", "json");
    const response = new Response(JSON.stringify(gems || []), {
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
  await context.env.DD_KV.put("dd:gems", JSON.stringify(sorted));

  const cache = caches.default;
  const origin = new URL(context.request.url).origin;
  await cache.delete(new Request(`${origin}/api/dd/gems`)).catch(() => {});

  return Response.json({ ok: true, count: sorted.length });
}
