/**
 * GET /api/dd/scouts
 * Returns the list of recent scout BUY discoveries:
 *   [{ ticker, score, grade, conf, thesis, key_swing, analyzed_at }, ...]
 */
export async function onRequestGet(context) {
  try {
    const scouts = await context.env.DD_KV.get("dd:scouts", "json");
    return new Response(JSON.stringify(scouts || []), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }
}
