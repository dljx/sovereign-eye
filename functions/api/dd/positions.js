/**
 * GET  /api/dd/positions — live portfolio ticker list for the sovereign-dd
 *       pre-market screen. Read-only: symbols only, no qty/cost.
 * POST /api/dd/positions — broker-scoped position sync from broker_sync.py
 *       (IBKR Flex + Tiger OpenAPI, both read-only fetches). Each broker key
 *       present in the payload fully REPLACES that broker's rows ("sync owns
 *       broker rows"); absent keys and rows with other broker tags are never
 *       touched, so one broker's API outage can't wipe the other's positions.
 *
 * Both verbs auth by Bearer <DD_UPLOAD_SECRET> (route is in _middleware
 * BEARER_PATHS; the regex form also rejects bare/empty Bearers — 2026-07-08 fix).
 *
 * GET response:  { "tickers": ["AMZN", "GOOG", ...] }
 * POST body:     { brokers: { "IBKR": [row], "Tiger": [row] },
 *                  cash: { "IBKR": n, "Tiger": n } | null }
 *   row = { ticker, qty, avg, name?, sector?, industry? } (broker tag applied
 *   server-side from the key). cash present → USD row avg = Σ values.
 * POST response: { ok, added, removed, updated, total }
 */
function validBearer(context) {
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) return { error: "DD_UPLOAD_SECRET not configured", status: 500 };
  const auth = context.request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\b\s*(.*)$/i);
  const token = m ? m[1].trim() : "";
  if (!token || token !== uploadSecret) return { error: "Unauthorized", status: 401 };
  return null;
}

export async function onRequestGet(context) {
  const authErr = validBearer(context);
  if (authErr) return Response.json({ error: authErr.error }, { status: authErr.status });

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

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
const SYNC_BROKERS = ["IBKR", "Tiger"]; // exact tags the UI styles/matches on

export async function onRequestPost(context) {
  const authErr = validBearer(context);
  if (authErr) return Response.json({ error: authErr.error }, { status: authErr.status });

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const brokers = body?.brokers;
  if (!brokers || typeof brokers !== "object" || Array.isArray(brokers)) {
    return Response.json({ error: "Expected { brokers: {...} }" }, { status: 400 });
  }
  const unknown = Object.keys(brokers).filter(b => !SYNC_BROKERS.includes(b));
  if (unknown.length) {
    return Response.json({ error: `unknown broker(s): ${unknown.join(", ")}` }, { status: 400 });
  }

  let existing = [];
  try {
    const raw = await context.env.DD_KV.get("positions:daryl", "json");
    if (Array.isArray(raw)) existing = raw;
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }

  // Prior enrichment (name/sector/industry keyed by ticker) survives a resync —
  // the brokers only supply ticker/qty/avg (+sometimes name).
  const enrich = new Map(existing.map(p => [String(p.ticker || "").toUpperCase(), p]));

  const added = [], removed = [], updated = [];
  let next = [...existing];

  for (const [broker, rows] of Object.entries(brokers)) {
    if (!Array.isArray(rows)) {
      return Response.json({ error: `brokers.${broker} must be an array` }, { status: 400 });
    }
    // NB: an empty array is a VALID payload — it means a genuinely emptied
    // account (full exit) and wipes that broker's equity rows by design.
    // Protection against a *misparsed* statement masquerading as empty lives
    // dd-side: broker_sync refuses statements with position elements that
    // parse to zero rows, and omits a broker entirely on fetch failure.
    // (2026-07-11 audit finding #7 considered and rejected — rejecting []
    // here would break the locked full-exit contract in test_broker_sync.)
    const cleaned = [];
    for (const r of rows) {
      const ticker = String(r?.ticker || "").toUpperCase().trim();
      const qty = Number(r?.qty);
      const avg = Number(r?.avg);
      if (!TICKER_RE.test(ticker) || ticker === "USD") {
        return Response.json({ error: `invalid ticker in ${broker}: ${r?.ticker}` }, { status: 400 });
      }
      if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(avg) || avg < 0) {
        return Response.json({ error: `invalid qty/avg for ${broker}:${ticker}` }, { status: 400 });
      }
      if (qty === 0) continue; // closed position — drop
      const prev = enrich.get(ticker) || {};
      cleaned.push({
        ticker,
        qty,
        avg,
        broker,
        name:     r?.name     || prev.name     || ticker,
        sector:   prev.sector   || r?.sector   || "",
        industry: prev.industry || r?.industry || "",
      });
    }

    // Replace this broker's EQUITY rows wholesale. The USD cash row also
    // carries a broker tag (dashboard convention) but is only ever managed
    // via the `cash` field below — never swept by the equity replace.
    const isSwept = p => p.broker === broker && String(p.ticker).toUpperCase() !== "USD";
    const before = new Map(next.filter(isSwept)
                               .map(p => [String(p.ticker).toUpperCase(), p]));
    next = next.filter(p => !isSwept(p));
    for (const row of cleaned) {
      const prev = before.get(row.ticker);
      if (!prev) added.push(`${broker}:${row.ticker}`);
      else if (Number(prev.qty) !== row.qty || Math.abs(Number(prev.avg) - row.avg) > 0.005) {
        updated.push(`${broker}:${row.ticker}`);
      }
      before.delete(row.ticker);
      next.push(row);
    }
    for (const gone of before.keys()) removed.push(`${broker}:${gone}`);
  }

  // Cash: USD row avg = Σ provided broker cash (dashboard convention: qty 1,
  // avg = dollars). Absent/null cash → USD row untouched.
  const cash = body?.cash;
  if (cash && typeof cash === "object" && !Array.isArray(cash)) {
    const entries = Object.entries(cash).filter(([b, v]) =>
      SYNC_BROKERS.includes(b) && Number.isFinite(Number(v)) && Number(v) >= 0);
    if (entries.length) {
      const total = entries.reduce((s, [, v]) => s + Number(v), 0);
      const tag = entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
      const i = next.findIndex(p => String(p.ticker).toUpperCase() === "USD");
      const usdRow = { ...(i >= 0 ? next[i] : { name: "Cash" }), ticker: "USD", qty: 1,
                       avg: +total.toFixed(2), broker: tag };
      if (i >= 0) next[i] = usdRow; else next.push(usdRow);
    }
  }

  try {
    await context.env.DD_KV.put("positions:daryl", JSON.stringify(next));
  } catch {
    return Response.json({ error: "KV write failed" }, { status: 503 });
  }

  return Response.json({ ok: true, added, removed, updated, total: next.length });
}
