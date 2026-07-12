/**
 * /api/dd/alert-state — dedup memory for the trigger engine (watch_triggers.py).
 *
 * A standing condition (a CONFIRM sitting in its entry window, a holding past
 * fair value) is true for days; without memory the daily trigger run would
 * re-alert every day. This stores the last-fired timestamp per (ticker, rule)
 * so an alert fires at most once per cooldown window.
 *
 * Auth: Bearer <DD_UPLOAD_SECRET> (in BEARER_PATHS; self-validates).
 * KV: alerts:state:v1 = { "<TICKER>|<rule>": "<ISO ts>" }
 *
 * GET  → the full state map (the trigger run reads it before deciding).
 * POST { fired: ["TICKER|rule", ...] } → stamp those keys with now(); returns ok.
 */

const KV_KEY = "alerts:state:v1";
const KEY_RE = /^[A-Z0-9.\-]{1,12}\|[a-z_]{1,24}$/;
const MAX_KEYS = 500;

function checkBearer(context) {
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) return { error: "DD_UPLOAD_SECRET not configured", status: 500 };
  const auth = context.request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s*(.*)$/i);
  const token = m ? m[1].trim() : "";
  if (!token || token !== uploadSecret) return { error: "Unauthorized", status: 401 };
  return null;
}

async function load(kv) {
  try {
    const raw = await kv.get(KV_KEY, "json");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const err = checkBearer(context);
  if (err) return Response.json({ error: err.error }, { status: err.status });
  const doc = await load(context.env.DD_KV);
  if (doc === null) return Response.json({ error: "KV unavailable" }, { status: 503 });
  return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost(context) {
  const err = checkBearer(context);
  if (err) return Response.json({ error: err.error }, { status: err.status });

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const fired = body?.fired;
  if (!Array.isArray(fired)) {
    return Response.json({ error: "Expected { fired: [...] }" }, { status: 400 });
  }

  const doc = await load(context.env.DD_KV);
  if (doc === null) return Response.json({ error: "KV unavailable" }, { status: 503 });

  const now = new Date().toISOString();
  let changed = false;
  for (const raw of fired) {
    const key = String(raw || "").toUpperCase().replace(/\|([A-Z_]+)$/, (_, r) => "|" + r.toLowerCase());
    if (!KEY_RE.test(key)) {
      return Response.json({ error: `invalid alert key: ${raw}` }, { status: 400 });
    }
    doc[key] = now;
    changed = true;
  }

  // Garbage-collect keys older than 60 days so the map can't grow unbounded.
  const cutoff = Date.now() - 60 * 86400000;
  for (const [k, ts] of Object.entries(doc)) {
    const t = Date.parse(ts);
    if (Number.isFinite(t) && t < cutoff) { delete doc[k]; changed = true; }
  }
  // Hard cap (defensive): keep the most-recent MAX_KEYS.
  const keys = Object.keys(doc);
  if (keys.length > MAX_KEYS) {
    const keep = new Set(keys.sort((a, b) => Date.parse(doc[b]) - Date.parse(doc[a])).slice(0, MAX_KEYS));
    for (const k of keys) if (!keep.has(k)) delete doc[k];
    changed = true;
  }

  let kvWrites = 0;
  if (changed) {
    try {
      await context.env.DD_KV.put(KV_KEY, JSON.stringify(doc));
      kvWrites = 1;
    } catch {
      return Response.json({ error: "KV write failed" }, { status: 503 });
    }
  }
  return Response.json({ ok: true, stamped: fired.length, kvWrites });
}
