/**
 * GET /api/nav-history
 *
 * Computes 14-month portfolio NAV vs SPY from Finnhub monthly candles.
 * Uses current positions from KV — shows "as-if held" history.
 * KV-cached 1 hour.
 */

const CACHE_KEY = 'nav:history:v1';
const MONTHS    = 14;

export async function onRequestGet(context) {
  const kv  = context.env.DD_KV;
  const key = (context.env.FINNHUB_API_KEY || '').trim();
  if (!key) return Response.json(null, { status: 400 });

  // Serve cache if present
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY, 'json');
      if (cached?.nav?.length) {
        return Response.json(cached, { headers: { 'X-Cache': 'HIT' } });
      }
    } catch (_) {}
  }

  // Load positions
  let positions = [];
  if (kv) {
    try {
      const raw = await kv.get('positions:daryl', 'json');
      if (Array.isArray(raw)) positions = raw;
    } catch (_) {}
  }

  const equity = positions.filter(p => p.ticker && p.ticker !== 'USD' && (p.qty || 0) > 0);
  if (!equity.length) return Response.json(null, { status: 404 });

  const now  = Math.floor(Date.now() / 1000);
  const from = now - (MONTHS + 3) * 31 * 86400; // buffer for monthly alignment

  const tickers = equity.map(p => p.ticker);
  const symbols = [...new Set([...tickers, 'SPY'])];

  // Fetch monthly candles in parallel
  const results = await Promise.all(
    symbols.map(sym =>
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${sym}&resolution=M&from=${from}&to=${now}&token=${key}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const candles = {};
  symbols.forEach((sym, i) => {
    const r = results[i];
    if (r?.s === 'ok' && Array.isArray(r.c) && r.c.length > 0) {
      candles[sym] = { t: r.t, c: r.c };
    }
  });

  const spy = candles['SPY'];
  if (!spy || spy.t.length < 2) return Response.json(null, { status: 500 });

  // Align to SPY's last MONTHS monthly timestamps
  const timelineTs = spy.t.slice(-MONTHS);
  const spyCloses  = spy.c.slice(-MONTHS);

  // For each timeline point, compute portfolio NAV
  const navSeries = timelineTs.map(ts => {
    let total = 0;
    for (const pos of equity) {
      const c = candles[pos.ticker];
      if (!c) {
        // No data: use avg cost as stand-in
        total += (pos.avg || 0) * (pos.qty || 0);
        continue;
      }
      // Find monthly close closest to this timestamp
      let bestIdx = 0, bestDiff = Infinity;
      c.t.forEach((t, i) => {
        const d = Math.abs(t - ts);
        if (d < bestDiff) { bestDiff = d; bestIdx = i; }
      });
      total += c.c[bestIdx] * (pos.qty || 0);
    }
    return total;
  });

  if (!navSeries[0]) return Response.json(null, { status: 500 });

  const navBase = navSeries[0];
  const spyBase = spyCloses[0];
  const nav = navSeries.map(v => +((v / navBase) * 100).toFixed(2));
  const spx = spyCloses.map(v => +((v / spyBase) * 100).toFixed(2));

  const labels = timelineTs.map(ts => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });

  const result = { nav, spx, labels };

  if (kv) {
    try {
      await kv.put(CACHE_KEY, JSON.stringify(result), { expirationTtl: 3600 });
    } catch (_) {}
  }

  return Response.json(result);
}
