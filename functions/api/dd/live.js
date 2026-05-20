/**
 * POST /api/dd/live
 * Called by GitHub Actions debate.py after each agent completes a round.
 * Accepts a full event list (replaces stored array — no KV read needed).
 * Auth: Authorization: Bearer <DD_UPLOAD_SECRET>
 *
 * Body: { ticker: "GOOG", events: [{...}, ...], done: bool }
 *
 * Batching note: the sovereign-dd live_events.py buffers events in memory
 * and sends the full accumulated list every 5 events.  This replaces the
 * prior per-event read+write pattern, cutting KV ops by ~5x.
 */
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
const MAX_EVENTS = 200;

export async function onRequestPost(context) {
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) {
    return Response.json({ error: "DD_UPLOAD_SECRET not configured" }, { status: 500 });
  }

  const auth = context.request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== uploadSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!context.env.DD_KV) {
    return Response.json({ error: "KV not configured" }, { status: 500 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = (body.ticker || "").toUpperCase().trim();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return Response.json({ error: "Missing or invalid ticker" }, { status: 400 });
  }

  // Accept batch (events: [...]) — full replacement, no KV read needed.
  // Also accept legacy single-event (event: {...}) for backward compatibility.
  let events;
  if (Array.isArray(body.events)) {
    events = body.events.slice(-MAX_EVENTS);
  } else if (body.event && body.event.type) {
    events = [{ ...body.event, _idx: 0 }];
  } else {
    return Response.json({ error: "Missing events or event.type" }, { status: 400 });
  }

  const isDone = body.done === true || events.some(e => e.type === "DONE");
  const kvKey  = `dd:live:${ticker}`;

  try {
    await context.env.DD_KV.put(kvKey, JSON.stringify(events), { expirationTtl: 3600 });
  } catch (e) {
    return Response.json({ error: "KV write failed", detail: String(e) }, { status: 500 });
  }

  return Response.json({ ok: true, count: events.length, done: isDone });
}
