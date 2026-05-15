/**
 * GET /api/dd/live/:ticker?after=N
 * Returns live debate events for a ticker, starting from index N.
 * Protected by the Basic-Auth middleware.
 *
 * Response: { events: [...], done: boolean, total: number }
 * `done` is true when a DONE event exists in the list.
 */
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export async function onRequestGet(context) {
  if (!context.env.DD_KV) {
    return Response.json({ events: [], done: false, total: 0 });
  }

  const ticker = (context.params.ticker || "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return Response.json({ error: "invalid ticker" }, { status: 400 });
  }

  const url   = new URL(context.request.url);
  const after = Math.max(0, parseInt(url.searchParams.get("after") || "0", 10));

  const kvKey = `dd:live:${ticker}`;

  let allEvents = [];
  try {
    const data = await context.env.DD_KV.get(kvKey, "json");
    if (Array.isArray(data)) allEvents = data;
  } catch {}

  const events = allEvents.slice(after);
  const done   = allEvents.some(e => e.type === "DONE");

  return new Response(JSON.stringify({ events, done, total: allEvents.length }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
