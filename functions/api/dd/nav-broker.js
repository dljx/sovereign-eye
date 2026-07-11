/**
 * POST /api/dd/nav-broker — daily broker NAV history sync from broker_sync.py
 * (Tiger get_analytics_asset + IBKR sovereign-nav Flex query, both already
 * converted to USD dd-side; the dd fetchers refuse rather than ship base-
 * currency values, see broker_sync.py).
 *
 * Broker-scoped replace, same philosophy as /api/dd/positions: each broker key
 * present in the payload fully REPLACES that broker's stored bundle; absent
 * brokers are never touched, so one broker's outage can't wipe the other's
 * history.
 *
 * Auth: Bearer <DD_UPLOAD_SECRET> (path is in _middleware BEARER_PATHS; this
 * handler re-validates like positions.js).
 *
 * Body: { brokers: { IBKR:  { navs:[{date,nav}], flows:[{date,amount}],
 *                             income:[{date,amount,type,ticker?}], twr? },
 *                    Tiger: {...} } }
 * KV:   nav:broker:v1 = { IBKR: {navs, flows, income, twr, updated}, ... }
 * Reply: { ok, brokers: {IBKR: {navs,flows,income}}, kvWrites }
 */

const KV_KEY = "nav:broker:v1";
const NAV_BROKERS = ["IBKR", "Tiger"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// ~6y of daily navs fits comfortably; caps bound the KV value size (~25MB max)
const CAPS = { navs: 2500, flows: 1000, income: 3000 };

function validBearer(context) {
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) return { error: "DD_UPLOAD_SECRET not configured", status: 500 };
  const auth = context.request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\b\s*(.*)$/i);
  const token = m ? m[1].trim() : "";
  if (!token || token !== uploadSecret) return { error: "Unauthorized", status: 401 };
  return null;
}

// Validate + normalize one broker bundle; returns {bundle} or {error}.
function cleanBundle(broker, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `brokers.${broker} must be an object` };
  }
  const navs = [], flows = [], income = [];

  for (const p of raw.navs || []) {
    const nav = Number(p?.nav);
    if (!DATE_RE.test(p?.date || "") || !Number.isFinite(nav) || nav < 0) {
      return { error: `invalid nav point in ${broker}: ${JSON.stringify(p)}` };
    }
    navs.push({ date: p.date, nav });
  }
  for (const f of raw.flows || []) {
    const amount = Number(f?.amount);
    if (!DATE_RE.test(f?.date || "") || !Number.isFinite(amount)) {
      return { error: `invalid flow in ${broker}: ${JSON.stringify(f)}` };
    }
    flows.push({ date: f.date, amount });
  }
  for (const r of raw.income || []) {
    const amount = Number(r?.amount);
    if (!DATE_RE.test(r?.date || "") || !Number.isFinite(amount)) {
      return { error: `invalid income row in ${broker}: ${JSON.stringify(r)}` };
    }
    income.push({
      date: r.date, amount,
      type: String(r?.type || "").slice(0, 48),
      ticker: String(r?.ticker || "").toUpperCase().slice(0, 12),
    });
  }
  if (!navs.length) return { error: `brokers.${broker} has no nav points` };

  // Dedup navs by date (last wins), sort everything chronologically, cap size.
  const byDate = new Map(navs.map(p => [p.date, p]));
  const sortedNavs = [...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1);
  const twr = Number.isFinite(Number(raw.twr)) ? Number(raw.twr) : null;
  return {
    bundle: {
      navs:   sortedNavs.slice(-CAPS.navs),
      flows:  flows.sort((a, b) => a.date < b.date ? -1 : 1).slice(-CAPS.flows),
      income: income.sort((a, b) => a.date < b.date ? -1 : 1).slice(-CAPS.income),
      twr,
    },
  };
}

const sansUpdated = b => JSON.stringify({ ...b, updated: 0 });

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
  const unknown = Object.keys(brokers).filter(b => !NAV_BROKERS.includes(b));
  if (unknown.length) {
    return Response.json({ error: `unknown broker(s): ${unknown.join(", ")}` }, { status: 400 });
  }
  if (!Object.keys(brokers).length) {
    return Response.json({ error: "no brokers in payload" }, { status: 400 });
  }

  let doc = {};
  try {
    const raw = await context.env.DD_KV.get(KV_KEY, "json");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) doc = raw;
  } catch {
    return Response.json({ error: "KV unavailable" }, { status: 503 });
  }

  let changed = false;
  const summary = {};
  for (const [broker, raw] of Object.entries(brokers)) {
    const { bundle, error } = cleanBundle(broker, raw);
    if (error) return Response.json({ error }, { status: 400 });
    if (!doc[broker] || sansUpdated(doc[broker]) !== sansUpdated(bundle)) {
      doc[broker] = { ...bundle, updated: new Date().toISOString() };
      changed = true;
    }
    summary[broker] = { navs: bundle.navs.length, flows: bundle.flows.length,
                        income: bundle.income.length };
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

  return Response.json({ ok: true, brokers: summary, kvWrites });
}
