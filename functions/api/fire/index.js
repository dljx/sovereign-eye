// GET  /api/fire  — read FIRE settings from KV (key: "fire:daryl")
// PUT  /api/fire  — write FIRE settings to KV
//
// Auth: Basic (dashboard) for both verbs. Bearer (DD_UPLOAD_SECRET) is allowed
// for GET ONLY — the quarterly fire_check cron reads the stored assumptions to
// review them, but must never be able to modify them (suggestions go to
// Telegram; the human keys in changes). This path is in BEARER_PATHS, so per
// the middleware contract it self-validates the token.

// Bearer scheme detection must catch a BARE "Authorization: Bearer" too —
// startsWith("Bearer ") missed it, and "no parsed bearer" was then treated as
// "Basic-authed", letting an unauthenticated bare-Bearer request through
// (defense in depth; the middleware now also refuses to forward bare Bearers).
function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\b\s*(.*)$/i);
  return m ? m[1].trim() : null; // "" for a bare Bearer — still non-null
}

export async function onRequestGet(context) {
  const token = bearerToken(context.request);
  if (token !== null &&
      (!token || !context.env.DD_UPLOAD_SECRET || token !== context.env.DD_UPLOAD_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await context.env.DD_KV.get("fire:daryl", "json");
    return Response.json(data || {});
  } catch (e) {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
}

export async function onRequestPut(context) {
  // Settings are human-owned: no bearer may write them, valid or not.
  if (bearerToken(context.request) !== null) {
    return Response.json({ error: "settings are Basic-auth only" }, { status: 403 });
  }
  try {
    const body = await context.request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Expected JSON object" }, { status: 400 });
    }
    await context.env.DD_KV.put("fire:daryl", JSON.stringify({
      ...body,
      updatedAt: new Date().toISOString(),
    }));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}
