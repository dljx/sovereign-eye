/**
 * POST /api/dd/upload
 * Called by GitHub Actions after analysis completes.
 * Body: { results: [{ key, value }], index: {...}, scouts: [...] }
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

  // Write individual ticker results
  for (const { key, value } of results) {
    try {
      await context.env.DD_KV.put(key, JSON.stringify(value));
      written.push(key);
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

  // Write scouts list
  if (Array.isArray(scouts)) {
    try {
      await context.env.DD_KV.put("dd:scouts", JSON.stringify(scouts));
      written.push("dd:scouts");
    } catch (e) {
      failed.push({ key: "dd:scouts", error: e.message });
    }
  }

  return Response.json({
    ok: failed.length === 0,
    written,
    failed,
  });
}
