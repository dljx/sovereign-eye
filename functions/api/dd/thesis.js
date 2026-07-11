/**
 * /api/dd/thesis — per-holding thesis registry + daily adherence checks.
 *
 * The anti-thesis-drift mechanism (2026-07-11): every holding has ONE
 * registered thesis (seeded from the system's analysis, editable by the
 * human); the daily portfolio run checks today's evidence against it and
 * reports INTACT / STRAINED / BROKEN. The registered thesis is a STABLE
 * anchor — it never auto-updates once set (drift is the failure mode this
 * exists to catch). Display + alert only; no board/gate/trading effect.
 *
 * KV: thesis:daryl = { "<TICKER>": { thesis, key_swing, set_at,
 *      source: "system"|"manual", status, adherence, reason, checked_at } }
 *
 * GET  (Bearer = dd pipeline, or dashboard Basic-auth): full registry.
 * POST (Bearer only, dd pipeline): { checks: {TICKER: {status, adherence,
 *      reason, checked_at, seed_thesis?, seed_key_swing?}}, held: [TICKER] }
 *      — seeds absent tickers (source:"system"), merges check results,
 *      deletes entries not in `held` (position closed). Never touches the
 *      thesis TEXT of an existing entry.
 * PUT  (dashboard): { ticker, thesis, key_swing? } → source:"manual";
 *      { ticker, reset: true } → delete entry (re-seeds on the next run).
 */

const KV_KEY = "thesis:daryl";
const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;
const STATUSES = new Set(["INTACT", "STRAINED", "BROKEN", "UNKNOWN"]);

function bearerToken(context) {
  const auth = context.request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\b\s*(.*)$/i);
  return m ? m[1].trim() : null; // null = no bearer (browser Basic-auth path)
}

// Bearer present → must match; absent → middleware Basic-auth already passed.
function rejectBadBearer(context) {
  const token = bearerToken(context);
  if (token === null) return null;
  if (!context.env.DD_UPLOAD_SECRET || token !== context.env.DD_UPLOAD_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function loadDoc(kv) {
  try {
    const raw = await kv.get(KV_KEY, "json");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return null; // KV unavailable
  }
}

export async function onRequestGet(context) {
  const bad = rejectBadBearer(context);
  if (bad) return bad;
  const doc = await loadDoc(context.env.DD_KV);
  if (doc === null) return Response.json({ error: "KV unavailable" }, { status: 503 });
  return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost(context) {
  // POST is the pipeline's verb — a Bearer is REQUIRED (a browser session
  // must not be able to fake check results).
  const token = bearerToken(context);
  if (!token || !context.env.DD_UPLOAD_SECRET || token !== context.env.DD_UPLOAD_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const checks = body?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return Response.json({ error: "Expected { checks: {...} }" }, { status: 400 });
  }

  const doc = await loadDoc(context.env.DD_KV);
  if (doc === null) return Response.json({ error: "KV unavailable" }, { status: 503 });
  const before = JSON.stringify(doc);

  const seeded = [], updated = [];
  for (const [rawTicker, c] of Object.entries(checks)) {
    const ticker = String(rawTicker || "").toUpperCase().trim();
    if (!TICKER_RE.test(ticker)) {
      return Response.json({ error: `invalid ticker: ${rawTicker}` }, { status: 400 });
    }
    const status = String(c?.status || "UNKNOWN").toUpperCase();
    if (!STATUSES.has(status)) {
      return Response.json({ error: `invalid status for ${ticker}: ${c?.status}` }, { status: 400 });
    }
    const adherence = Number.isFinite(Number(c?.adherence)) && c?.adherence != null
      ? Math.max(0, Math.min(10, Number(c.adherence))) : null;

    if (!doc[ticker]) {
      // Seed: first time this holding is checked. The registered thesis is
      // frozen from here — only a manual edit or reset changes it.
      const seedThesis = String(c?.seed_thesis || "").slice(0, 1200);
      if (!seedThesis) continue; // nothing to register yet — skip silently
      doc[ticker] = {
        thesis: seedThesis,
        key_swing: String(c?.seed_key_swing || "").slice(0, 400),
        set_at: new Date().toISOString(),
        source: "system",
      };
      seeded.push(ticker);
    } else {
      updated.push(ticker);
    }
    Object.assign(doc[ticker], {
      status,
      adherence,
      reason: String(c?.reason || "").slice(0, 300),
      checked_at: c?.checked_at || new Date().toISOString(),
    });
  }

  // Departed positions leave the registry — only when the caller supplies a
  // NON-EMPTY holdings list. An empty array (e.g. a transiently-failed
  // positions fetch upstream) must never wipe the registry: it would delete
  // every manually-authored thesis in one write (2026-07-11 audit, P1).
  const removed = [];
  if (Array.isArray(body.held) && body.held.length > 0) {
    const held = new Set(body.held.map(t => String(t || "").toUpperCase().trim()));
    for (const t of Object.keys(doc)) {
      if (!held.has(t)) {
        delete doc[t];
        removed.push(t);
      }
    }
  }

  let kvWrites = 0;
  if (JSON.stringify(doc) !== before) {
    try {
      await context.env.DD_KV.put(KV_KEY, JSON.stringify(doc));
      kvWrites = 1;
    } catch {
      return Response.json({ error: "KV write failed" }, { status: 503 });
    }
  }
  return Response.json({ ok: true, seeded, updated, removed, kvWrites });
}

export async function onRequestPut(context) {
  const bad = rejectBadBearer(context);
  if (bad) return bad;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ticker = String(body?.ticker || "").toUpperCase().trim();
  if (!TICKER_RE.test(ticker)) {
    return Response.json({ error: "invalid ticker" }, { status: 400 });
  }

  const doc = await loadDoc(context.env.DD_KV);
  if (doc === null) return Response.json({ error: "KV unavailable" }, { status: 503 });

  if (body.reset === true) {
    delete doc[ticker]; // re-seeds from the next portfolio run
  } else {
    const thesis = String(body?.thesis || "").trim().slice(0, 1200);
    if (!thesis) return Response.json({ error: "thesis text required" }, { status: 400 });
    doc[ticker] = {
      ...(doc[ticker] || {}),
      thesis,
      ...(body.key_swing != null ? { key_swing: String(body.key_swing).slice(0, 400) } : {}),
      set_at: new Date().toISOString(),
      source: "manual",
    };
  }

  try {
    await context.env.DD_KV.put(KV_KEY, JSON.stringify(doc));
  } catch {
    return Response.json({ error: "KV write failed" }, { status: 503 });
  }
  return Response.json({ ok: true, ticker, entry: doc[ticker] || null });
}
