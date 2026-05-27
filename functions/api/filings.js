/**
 * GET /api/filings?tickers=AMZN,MSFT,...
 *
 * Returns recent SEC filings for portfolio tickers via Finnhub.
 * KV-cached for 60 minutes.
 */

const CACHE_KEY  = 'sec:filings:v1';
const CACHE_TTL  = 60 * 60 * 1000;
const MEANINGFUL = new Set(['8-K','10-Q','10-K','S-1','DEF 14A','6-K','10-K/A','8-K/A']);

function relDate(d) {
  if (!d) return '';
  try {
    const ms = Date.now() - new Date(d).getTime();
    const days = Math.floor(ms / 86400000);
    if (days < 1) return 'today';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  } catch { return d.slice(0, 10); }
}

export async function onRequestGet(context) {
  const kv  = context.env.SE_KV;
  const key = (context.env.FINNHUB_API_KEY || '').trim();
  if (!key) return Response.json([], { status: 200 });

  const url     = new URL(context.request.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase()).filter(t => /^[A-Z]{1,10}$/.test(t)).slice(0, 10);
  if (!tickers.length) return Response.json([], { status: 200 });

  // Check cache
  if (kv) {
    try {
      const cached = await kv.getWithMetadata(CACHE_KEY, { type: 'json' });
      if (cached?.value && cached.metadata?.ts && Date.now() - cached.metadata.ts < CACHE_TTL) {
        return Response.json(cached.value, { headers: { 'X-Cache': 'HIT' } });
      }
    } catch (_) { /* cache miss */ }
  }

  // Fetch in parallel
  const results = await Promise.all(
    tickers.map(t =>
      fetch(`https://finnhub.io/api/v1/stock/filings?symbol=${t}&token=${key}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const filings = [];
  tickers.forEach((tk, i) => {
    if (!Array.isArray(results[i])) return;
    results[i]
      .filter(f => MEANINGFUL.has(f.form))
      .slice(0, 2)
      .forEach(f => filings.push({
        form: f.form,
        tk,
        tldr: '',
        sent: 'neutral',
        when: relDate(f.filedDate || f.reportDate || ''),
      }));
  });

  filings.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  const out = filings.slice(0, 12);

  if (kv && out.length) {
    try {
      await kv.put(CACHE_KEY, JSON.stringify(out), { metadata: { ts: Date.now() } });
    } catch (_) { /* ignore */ }
  }

  return Response.json(out);
}
