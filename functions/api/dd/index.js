/**
 * GET /api/dd/
 * Returns the master index of all analyzed tickers:
 *   { TICKER: { score, grade, conf, updated, loops, spread }, ... }
 */
export async function onRequestGet(context) {
  const index = await context.env.DD_KV.get("dd:index", "json");
  return new Response(JSON.stringify(index || {}), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
