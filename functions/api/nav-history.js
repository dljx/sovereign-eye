/**
 * GET /api/nav-history
 *
 * Portfolio NAV history vs benchmarks. Two data sources, best first:
 *   1. nav:broker:v1 (real daily broker NAV from broker_sync.py — Tiger
 *      analytics + IBKR Flex, USD, incl. cash & fees) — used whenever present.
 *      Adds VWRA.L + SPY benchmark series (Yahoo chart, edge-cached 1h) and a
 *      flow-adjusted TWR ("perf" block) computed from broker deposit/
 *      withdrawal rows.
 *   2. nav:snapshots:v1 — the legacy quote-derived forward accumulator. Still
 *      stamped daily (fallback safety) and served when broker data is absent.
 *
 * Combined-series rule: the total starts at the LATEST first-date across
 * brokers (common span) — summing a broker in from mid-series would fake a
 * NAV jump that TWR would read as return.
 *
 * Response: { nav, spx, vwra?, labels, raw: {dates, nav, spy, vwra?}, perf? }
 * (nav/spx/vwra normalized to 100 at the first point; raw is dollars.)
 */

import { drain } from "./_util.js";

const SNAP_KEY  = 'nav:snapshots:v1';
const BROKER_KEY = 'nav:broker:v1';
// 5 years of dailies (~60KB at 5y — far under the 25MB KV value cap). Was 90,
// which silently discarded history the FIRE tab needs.
const MAX_SNAPS = 1825;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── pure helpers (exported for tests) ─────────────────────────────────────────

// {IBKR: {navs, flows}, ...} → {dates, nav, flows: Map, income: []} summed
// across brokers over their COMMON span, forward-filling per-broker gaps
// (Tiger reports calendar days, IBKR business days).
export function combineBrokerNav(doc) {
  const brokers = Object.entries(doc || {})
    .filter(([, b]) => Array.isArray(b?.navs) && b.navs.length);
  if (!brokers.length) return null;

  const series = brokers.map(([name, b]) => {
    const m = new Map();
    for (const p of b.navs) {
      const v = Number(p?.nav);
      if (p?.date && Number.isFinite(v)) m.set(p.date, v);
    }
    return { name, m, first: [...m.keys()].sort()[0] };
  }).filter(s => s.m.size);
  if (!series.length) return null;

  const start = series.map(s => s.first).sort().at(-1); // latest inception
  const dates = [...new Set(series.flatMap(s => [...s.m.keys()]))]
    .filter(d => d >= start).sort();
  if (!dates.length) return null;

  // Seed each broker with its most recent value at-or-before the common start.
  // Without this, a broker with no point exactly ON start (calendar mismatch:
  // one broker reports weekends, the other doesn't) contributes 0 on day one
  // and its full balance the next day — a fabricated NAV jump that twrPct
  // reads as return (2026-07-11 audit, P0).
  const last = new Map();
  for (const s of series) {
    const prior = [...s.m.keys()].filter(d => d <= start).sort().at(-1);
    if (prior !== undefined) last.set(s.name, s.m.get(prior));
  }
  const nav = dates.map(d => {
    let sum = 0;
    for (const s of series) {
      if (s.m.has(d)) last.set(s.name, s.m.get(d));
      sum += last.get(s.name) ?? 0;
    }
    return +sum.toFixed(2);
  });

  const flows = new Map();
  for (const [, b] of brokers) {
    for (const f of b.flows || []) {
      const v = Number(f?.amount);
      if (f?.date && f.date >= start && Number.isFinite(v)) {
        flows.set(f.date, +((flows.get(f.date) || 0) + v).toFixed(2));
      }
    }
  }
  const income = brokers.flatMap(([name, b]) =>
    (b.income || []).map(r => ({ ...r, broker: name })));
  return { dates, nav, flows, income };
}

// Flow-adjusted time-weighted return (%) with end-of-day flow convention:
// r_t = (V_t - F_t) / V_{t-1} - 1, chained over the series.
export function twrPct(dates, nav, flows) {
  let chain = 1, prev = null;
  for (let i = 0; i < dates.length; i++) {
    const v = nav[i];
    if (prev != null && prev > 0 && Number.isFinite(v)) {
      chain *= (v - (flows.get(dates[i]) || 0)) / prev;
    }
    if (Number.isFinite(v)) prev = v;
  }
  return (chain - 1) * 100;
}

// Forward-fill a date→close map onto the portfolio's date grid; leading
// dates before the benchmark's first close reuse the first known value so
// base-100 normalization stays meaningful.
export function alignCloses(dates, closeMap) {
  const keys = [...closeMap.keys()].sort();
  if (!keys.length) return null;
  let ki = -1, lastV = null;
  const out = dates.map(d => {
    while (ki + 1 < keys.length && keys[ki + 1] <= d) { ki++; lastV = closeMap.get(keys[ki]); }
    return lastV;
  });
  const firstKnown = out.find(v => v != null);
  if (firstKnown == null) return null;
  return out.map(v => v == null ? firstKnown : v);
}

// ── benchmark closes (Yahoo chart; edge-cached 1h against the Yahoo URL) ──────

async function yahooCloses(context, symbol, startDate) {
  const period1 = Math.floor(Date.parse(startDate + "T00:00:00Z") / 1000) - 86400 * 7;
  // Day-bucketed (midnight UTC tomorrow): period2 in raw seconds changed the
  // URL — and therefore the cache key — every second, so the "1h edge cache"
  // never hit and every render refetched Yahoo (2026-07-11 audit, P1).
  const period2 = (Math.floor(Date.now() / 86400000) + 1) * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
              `?interval=1d&period1=${period1}&period2=${period2}`;
  const cache = caches.default;
  const req = new Request(url);
  let r = await cache.match(req);
  if (!r) {
    try {
      const live = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" },
                                      signal: AbortSignal.timeout(8000) });
      if (!live.ok) { drain(live); return null; }
      r = new Response(await live.arrayBuffer(),
                       { headers: { "Cache-Control": "public, s-maxage=3600" } });
      context.waitUntil(cache.put(req, r.clone()));
    } catch { return null; }
  }
  try {
    const data = await r.json();
    const res = data?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const closes = res?.indicators?.quote?.[0]?.close || [];
    const out = new Map();
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] > 0) out.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), closes[i]);
    }
    return out.size ? out : null;
  } catch { return null; }
}

// ── handler ───────────────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  // Bearer callers (the dd cron's daily NAV stamp) must present the upload
  // secret — this path is in BEARER_PATHS, and the middleware contract says
  // bearer-reachable endpoints self-validate. Basic-auth browser traffic
  // arrives here already authenticated with no Bearer header. The regex form
  // catches a BARE "Bearer" too (startsWith("Bearer ") missed it, which
  // treated bare-Bearer requests as authenticated — found live 2026-07-08).
  const auth = context.request.headers.get("Authorization") || "";
  const bearerMatch = auth.match(/^Bearer\b\s*(.*)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1].trim();
    if (!token || !context.env.DD_UPLOAD_SECRET || token !== context.env.DD_UPLOAD_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const kv  = context.env.DD_KV;
  const key = (context.env.FINNHUB_API_KEY || '').trim();
  if (!kv) return Response.json(null, { status: 503 });

  // Load positions (for the legacy snapshot stamp)
  let positions = [];
  try {
    const raw = await kv.get('positions:daryl', 'json');
    if (Array.isArray(raw)) positions = raw;
  } catch (_) {}
  const equity = positions.filter(p => p.ticker && p.ticker !== 'USD' && (p.qty || 0) > 0);

  // Load existing snapshots
  let snaps = [];
  try {
    const stored = await kv.get(SNAP_KEY, 'json');
    if (Array.isArray(stored)) snaps = stored;
  } catch (_) {}

  const today = todayStr();
  const alreadyHaveToday = snaps.length > 0 && snaps[snaps.length - 1].date === today;

  // Legacy daily snapshot stamp — kept as the fallback accumulator even now
  // that broker NAV is primary (a broker-side outage must not leave a hole).
  if (!alreadyHaveToday && key && equity.length) {
    const tickers = equity.map(p => p.ticker);
    const allSyms = [...new Set([...tickers, 'SPY'])];
    const qUrl    = `https://finnhub.io/api/v1/quote?symbol=PLACEHOLDER&token=${key}`;

    const quotes = {};
    await Promise.all(
      allSyms.map(sym =>
        fetch(qUrl.replace('PLACEHOLDER', sym), { signal: AbortSignal.timeout(5000) })
          .then(r => r.ok ? r.json() : null)
          .then(q => { if (q?.c) quotes[sym] = q.c; })
          .catch(() => {})
      )
    );

    const portfolioNav = equity.reduce((sum, p) => {
      const px = quotes[p.ticker];
      return px ? sum + px * p.qty : sum;
    }, 0);

    const spyClose = quotes['SPY'];

    if (portfolioNav > 0 && spyClose) {
      // Re-read immediately before writing to narrow the race window, then
      // always dedup by date so concurrent writers can't leave duplicate rows.
      try {
        const latest = await kv.get(SNAP_KEY, 'json');
        if (Array.isArray(latest)) snaps = latest;
      } catch (_) {}
      snaps.push({ date: today, nav: portfolioNav, spy: spyClose });
      const byDate = new Map();
      snaps.forEach(s => byDate.set(s.date, s));
      snaps = [...byDate.values()];
      if (snaps.length > MAX_SNAPS) snaps = snaps.slice(-MAX_SNAPS);
      try {
        await kv.put(SNAP_KEY, JSON.stringify(snaps));
      } catch (_) {}
    }
  }

  // ── primary path: real broker NAV ────────────────────────────────────────
  let brokerDoc = null;
  try {
    brokerDoc = await kv.get(BROKER_KEY, 'json');
  } catch (_) {}
  const combined = combineBrokerNav(brokerDoc);

  if (combined && combined.dates.length >= 2) {
    const { dates, nav, flows, income } = combined;
    const [spyMap, vwraMap] = await Promise.all([
      yahooCloses(context, 'SPY', dates[0]),
      yahooCloses(context, 'VWRA.L', dates[0]),
    ]);
    const spy = spyMap ? alignCloses(dates, spyMap) : null;

    if (spy) {
      const vwra = vwraMap ? alignCloses(dates, vwraMap) : null;
      const norm = arr => arr.map(v => +((v / arr[0]) * 100).toFixed(2));
      const labels = dates.map(d =>
        new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

      const twr = twrPct(dates, nav, flows);
      const perf = {
        source: 'broker',
        since: dates[0],
        twrPct: +twr.toFixed(2),
        spyPct: +(((spy.at(-1) / spy[0]) - 1) * 100).toFixed(2),
        vwraPct: vwra ? +(((vwra.at(-1) / vwra[0]) - 1) * 100).toFixed(2) : null,
        ibkrTwrPct: Number.isFinite(brokerDoc?.IBKR?.twr) ? brokerDoc.IBKR.twr : null,
      };

      return Response.json({
        nav: norm(nav),
        spx: norm(spy),
        ...(vwra ? { vwra: norm(vwra) } : {}),
        labels,
        raw: {
          dates,
          nav,
          spy: spy.map(v => +v.toFixed(2)),
          ...(vwra ? { vwra: vwra.map(v => +v.toFixed(2)) } : {}),
          // deposit/withdrawal rows — lets dd's behavior-gap tracker compute
          // subrange TWR with the same chain formula
          flows: [...flows.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
            .map(([date, amount]) => ({ date, amount })),
        },
        perf,
        income,
      });
    }
    // benchmark fetch failed → fall through to snapshots (never a bare series)
  }

  // ── fallback: legacy quote-derived snapshots ─────────────────────────────
  if (snaps.length < 1) return Response.json(null, { status: 404 });

  const navBase = snaps[0].nav;
  const spyBase = snaps[0].spy;
  const nav    = snaps.map(s => +((s.nav / navBase) * 100).toFixed(2));
  const spx    = snaps.map(s => +((s.spy / spyBase) * 100).toFixed(2));
  const labels = snaps.map(s => {
    const d = new Date(s.date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  // `raw` (added for the FIRE tab) carries the un-normalized series — the
  // normalized base-100 arrays above can't be converted back to dollars.
  return Response.json({
    nav, spx, labels,
    raw: {
      dates: snaps.map(s => s.date),
      nav:   snaps.map(s => +s.nav.toFixed(2)),
      spy:   snaps.map(s => +s.spy.toFixed(2)),
    },
  });
}
