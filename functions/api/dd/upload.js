/**
 * POST /api/dd/upload
 * Called by GitHub Actions after analysis completes.
 * Body: { results: [{ key, value }], index: {...}, scouts: [...], gems: [...], scout_history: {...}, scout_notified: {...} }
 * Auth: Authorization: Bearer <DD_UPLOAD_SECRET>
 *
 * Bypasses the Basic-Auth middleware using a dedicated upload secret so
 * the GitHub Action doesn't need Cloudflare API tokens.
 */
export async function onRequestPost(context) {
  // Auth check — use a dedicated secret, not the dashboard password
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) {
    return Response.json({ error: "DD_UPLOAD_SECRET not configured" }, { status: 500 });
  }

  const auth = context.request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== uploadSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { results = [], index, scouts } = body;
  const written = [];
  const failed = [];

  // Write individual ticker results + clean up live event keys
  for (const { key, value } of results) {
    try {
      await context.env.DD_KV.put(key, JSON.stringify(value));
      written.push(key);
      // Delete the live event stream now that final result is stored
      if (key.startsWith("dd:")) {
        const ticker = key.slice(3); // "dd:GOOG" → "GOOG"
        await context.env.DD_KV.delete(`dd:live:${ticker}`).catch(() => {});
      }
    } catch (e) {
      failed.push({ key, error: e.message });
    }
  }

  // Write master index
  if (index && typeof index === "object") {
    try {
      await context.env.DD_KV.put("dd:index", JSON.stringify(index));
      written.push("dd:index");
    } catch (e) {
      failed.push({ key: "dd:index", error: e.message });
    }
  }

  // Merge new scouts into the existing accumulated list (never replace wholesale).
  // Dedup by ticker — newest entry wins. Cap at 100 to bound KV value size.
  if (Array.isArray(scouts) && scouts.length > 0) {
    try {
      let existing = [];
      const raw = await context.env.DD_KV.get("dd:scouts");
      if (raw) {
        try { existing = JSON.parse(raw); } catch {}
      }
      // Build a map keyed by ticker; new entries overwrite older ones
      const map = new Map((Array.isArray(existing) ? existing : []).map(s => [s.ticker, s]));
      for (const s of scouts) map.set(s.ticker, s);
      // Sort by score descending, cap at 100
      const merged = [...map.values()].sort((a, b) => b.score - a.score).slice(0, 100);
      await context.env.DD_KV.put("dd:scouts", JSON.stringify(merged));
      written.push("dd:scouts");
    } catch (e) {
      failed.push({ key: "dd:scouts", error: e.message });
    }
  }

  // Persist scout history and notification history for cache-miss recovery in CI.
  // Written as scout:history and scout:notified — fetched by download_history.py
  // when the GitHub Actions cache is cold.
  for (const [field, kvKey] of [
    ["scout_history",  "scout:history"],
    ["scout_notified", "scout:notified"],
  ]) {
    const data = body[field];
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      try {
        await context.env.DD_KV.put(kvKey, JSON.stringify(data));
        written.push(kvKey);
      } catch (e) {
        failed.push({ key: kvKey, error: e.message });
      }
    }
  }

  return Response.json({
    ok: failed.length === 0,
    written,
    failed,
  });
}
