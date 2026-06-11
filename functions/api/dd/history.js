/**
 * GET /api/dd/history
 * Returns scout_history and scout_notified from KV for cache-miss recovery in CI.
 * Called by download_history.py in GitHub Actions when actions/cache/restore misses.
 * Auth: Authorization: Bearer <DD_UPLOAD_SECRET>
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

  const [historyRaw, notifiedRaw, gemsRaw, seenRaw] = await Promise.all([
    context.env.DD_KV.get("scout:history"),
    context.env.DD_KV.get("scout:notified"),
    context.env.DD_KV.get("gems:history"),
    context.env.DD_KV.get("scout:seen"),
  ]);

  let history  = {};
  let notified = {};
  let gems     = {};
  let seen     = {};
  try { if (historyRaw)  history  = JSON.parse(historyRaw);  } catch {}
  try { if (notifiedRaw) notified = JSON.parse(notifiedRaw); } catch {}
  try { if (gemsRaw)     gems     = JSON.parse(gemsRaw);     } catch {}
  try { if (seenRaw)     seen     = JSON.parse(seenRaw);     } catch {}

  return Response.json({ history, notified, gems, seen });
}
