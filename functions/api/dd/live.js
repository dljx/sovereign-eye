/**
 * POST /api/dd/live
 * Called by GitHub Actions debate.py after each agent completes a round.
 * Appends a single live event to the KV event list for that ticker.
 * Auth: Authorization: Bearer <DD_UPLOAD_SECRET>
 *
 * Body: { ticker: "GOOG", event: { type, agent, score, target, challenge, delta, grade, ts } }
 */
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
const MAX_EVENTS = 200; // guard against unbounded KV write growth

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
  const event  = body.event;
  if (!ticker || !TICKER_RE.test(ticker) || !event || !event.type) {
    return Response.json({ error: "Missing or invalid ticker / event.type" }, { status: 400 });
  }

  const kvKey = `dd:live:${ticker}`;

  // Read existing events, append new one, write back with 1-hour TTL
  let events = [];
  try {
    const existing = await context.env.DD_KV.get(kvKey, "json");
    if (Array.isArray(existing)) events = existing;
  } catch {}

  events.push({ ...event, _idx: events.length });

  // Cap to prevent unbounded KV write growth (keeps most recent events)
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);

  try {
    await context.env.DD_KV.put(kvKey, JSON.stringify(events), { expirationTtl: 3600 });
  } catch (e) {
    return Response.json({ error: "KV write failed", detail: String(e) }, { status: 500 });
  }

  return Response.json({ ok: true, count: events.length });
}
