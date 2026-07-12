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
  // Manual-cleanup verb: dashboard Basic auth ONLY — any Bearer is rejected
  // (mirrors /api/fire PUT; the pipeline has no business replacing boards).
  if ((context.request.headers.get("Authorization") || "").match(/^Bearer/i)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
