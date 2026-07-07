// GET  /api/positions  — read positions from KV (key: "positions:daryl")
// PUT  /api/positions  — write positions to KV
// Protected by the _middleware.js Basic Auth that wraps all /api/* routes.

export async function onRequestGet(context) {
  try {
    const data = await context.env.DD_KV.get("positions:daryl", "json");
    return Response.json(data || []);
  } catch (e) {
    // Honest failure: a KV outage must not render as "empty portfolio".
    // All frontend callers guard with r.ok and keep their local fallback.
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
}

export async function onRequestPut(context) {
  try {
    const body = await context.request.json();
    if (!Array.isArray(body)) {
      return Response.json({ error: "Expected JSON array" }, { status: 400 });
    }
    await context.env.DD_KV.put("positions:daryl", JSON.stringify(body));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}
