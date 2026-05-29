/**
 * GET /api/nav-history
 *
 * Returns daily portfolio NAV snapshots vs SPY close, built from real
 * live quotes. Appends one snapshot per calendar day to KV.
 * No historical candle API needed — data accumulates forward from first use.
 */

const SNAP_KEY  = 'nav:snapshots:v1';
const MAX_SNAPS = 90; // keep up to 90 daily points

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
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
        fetch(qUrl.replace('PLACEHOLDER', sym))
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
      // Re-read immediately before writing to narrow the read-modify-write race
      // (two same-day GETs both appending), then dedupe by date so a concurrent
      // writer can't leave two snapshots for `today`.
      try {
        const latest = await kv.get(SNAP_KEY, 'json');
        if (Array.isArray(latest)) snaps = latest;
      } catch (_) {}
      const haveToday = snaps.length > 0 && snaps[snaps.length - 1].date === today;
      if (!haveToday) {
        snaps.push({ date: today, nav: portfolioNav, spy: spyClose });
        if (snaps.length > MAX_SNAPS) snaps = snaps.slice(-MAX_SNAPS);
        try {
          await kv.put(SNAP_KEY, JSON.stringify(snaps));
        } catch (_) {}
      }
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

  return Response.json({ nav, spx, labels });
}
