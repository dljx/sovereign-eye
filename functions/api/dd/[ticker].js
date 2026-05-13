/**
 * GET /api/dd/:ticker
 * Returns the latest full sovereign-dd analysis for a ticker from Cloudflare KV.
 */
export async function onRequestGet(context) {
  const ticker = context.params.ticker.toUpperCase();
  const data = await context.env.DD_KV.get(`dd:${ticker}`, "json");
  if (!data) {
    return new Response(JSON.stringify({ error: "not found", ticker }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
