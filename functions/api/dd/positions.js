/**
 * GET /api/dd/positions
 * Returns the live portfolio ticker list from KV (positions:daryl) so the
 * sovereign-dd pre-market screen analyzes what you ACTUALLY hold instead of a
 * ticker list hardcoded in the GitHub Actions workflow.
 *
 * Mirrors /api/dd/history: authed by Bearer <DD_UPLOAD_SECRET> (bypasses the
 * dashboard Basic auth via _middleware BEARER_PATHS). Read-only — never exposes
 * cost basis / share counts, only the symbols.
 *
 * Response: { "tickers": ["AMZN", "GOOG", ...] }
 */
export async function onRequestGet(context) {
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) {
    return Response.json({ error: "DD_UPLOAD_SECRET not configured" }, { status: 500 });
  }

  const auth  = context.request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== uploadSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let positions = [];
  try {
    positions = (await context.env.DD_KV.get("positions:daryl", "json")) || [];
  } catch {
    positions = [];
  }

  const tickers = [...new Set(
    (Array.isArray(positions) ? positions : [])
      .map(p => String(p?.ticker || p?.symbol || "").toUpperCase().trim())
      .filter(Boolean)
  )];

  return Response.json({ tickers }, { headers: { "Cache-Control": "no-store" } });
}
