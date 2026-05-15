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
  try {
    const data = await context.env.DD_KV.get(`dd:${ticker}`, "json");
    if (!data) {
      return Response.json({ error: "not found", ticker }, { status: 404 });
    }
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
}
