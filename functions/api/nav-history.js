/**
 * GET /api/nav-history
 *
 * Returns daily portfolio NAV snapshots vs SPY close, built from real
 * live quotes. Appends one snapshot per calendar day to KV.
 * No historical candle API needed — data accumulates forward from first use.
 */

const SNAP_KEY  = 'nav:snapshots:v1';
// 5 years of dailies (~60KB at 5y — far under the 25MB KV value cap). Was 90,
// which silently discarded history the FIRE tab needs.
const MAX_SNAPS = 1825;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  // Bearer callers (the dd cron's daily NAV stamp) must present the upload
  // secret — this path is in BEARER_PATHS, and the middleware contract says
  // bearer-reachable endpoints self-validate. Basic-auth browser traffic
  // arrives here already authenticated with no Bearer header.
  const auth = context.request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    if (!context.env.DD_UPLOAD_SECRET || auth.slice(7) !== context.env.DD_UPLOAD_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const kv  = context.env.DD_KV;
  const key = (context.env.FINNHUB_API_KEY || '').trim();
  if (!key || !kv) return Response.json(null, { status: 503 });

  // Load positions
  let positions = [];
  try {
    const raw = await kv.get('positions:daryl', 'json');
    if (Array.isArray(raw)) positions = raw;
  } catch (_) {}

  const equity = positions.filter(p => p.ticker && p.ticker !== 'USD' && (p.qty || 0) > 0);
  if (!equity.length) return Response.json(null, { status: 404 });

  // Load existing snapshots
  let snaps = [];
  try {
    const stored = await kv.get(SNAP_KEY, 'json');
    if (Array.isArray(stored)) snaps = stored;
  } catch (_) {}

  const today = todayStr();
  const alreadyHaveToday = snaps.length > 0 && snaps[snaps.length - 1].date === today;

  // Fetch live quotes for all positions + SPY
  if (!alreadyHaveToday) {
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
      // Dedup: last writer wins for the same date
      const byDate = new Map();
      snaps.forEach(s => byDate.set(s.date, s));
      snaps = [...byDate.values()];
      if (snaps.length > MAX_SNAPS) snaps = snaps.slice(-MAX_SNAPS);
      try {
        await kv.put(SNAP_KEY, JSON.stringify(snaps));
      } catch (_) {}
    }
  }

  if (snaps.length < 1) return Response.json(null, { status: 404 });

  // Normalise both series to 100 at first snapshot
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
