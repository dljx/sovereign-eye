/**
 * GET /api/filings?tickers=AMZN,MSFT,...
 *
 * Returns recent SEC filings for portfolio tickers via Finnhub,
 * with Gemini-generated TL;DRs and direct SEC.gov links.
 * KV-cached 60 minutes.
 */

const CACHE_TTL  = 3600;
const MEANINGFUL = new Set(['8-K','10-Q','10-K','S-1','DEF 14A','6-K','10-K/A','8-K/A']);

function relDate(d) {
  if (!d) return '';
  try {
    const ms = Date.now() - new Date(d).getTime();
    const days = Math.floor(ms / 86400000);
    if (days < 1)  return 'today';
    if (days < 7)  return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  } catch { return d.slice(0, 10); }
}

async function generateTldrs(gemKey, filings) {
  if (!gemKey || !filings.length) return [];

  const list = filings.map((f, i) =>
    `${i + 1}. ${f.tk} — ${f.form} filed ${f.filedDate || f.when}`
  ).join('\n');

  const prompt = `You are a financial analyst. For each SEC filing below, write a concise 1-sentence TLDR (under 18 words) summarising what the filing likely disclosed, based on your knowledge of the company's business and recent performance. If you're uncertain, describe what the form type typically covers for this company.

Return ONLY a JSON array of strings in the same order as the input. No markdown, no preamble.

Filings:
${list}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${gemKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const raw   = (parts[0] || {}).text || '';
    const jsonStr = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed  = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function onRequestGet(context) {
  const kv     = context.env.DD_KV;
  const fhKey  = (context.env.FINNHUB_API_KEY || '').trim();
  const gemKey = (context.env.GEMINI_API_KEY  || '').trim();

  if (!fhKey) return Response.json([]);

  const url     = new URL(context.request.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase())
    .filter(t => /^[A-Z]{1,10}$/.test(t)).slice(0, 10);
  if (!tickers.length) return Response.json([]);

  const cacheKey = `sec:filings:v3:${[...tickers].sort().join(',')}`;

  // Serve cache
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, 'json');
      if (Array.isArray(cached) && cached.length && cached.some(f => f.tldr)) {
        return Response.json(cached, { headers: { 'X-Cache': 'HIT' } });
      }
    } catch (_) {}
  }

  // Fetch Finnhub filings in parallel
  const results = await Promise.all(
    tickers.map(t =>
      fetch(`https://finnhub.io/api/v1/stock/filings?symbol=${t}&token=${fhKey}`)
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
        form:       f.form,
        tk,
        tldr:       '',
        sent:       'neutral',
        when:       relDate(f.filedDate || f.reportDate || ''),
        filedDate:  f.filedDate || '',
        url:        f.reportUrl || f.filingUrl || '',
      }));
  });

  filings.sort((a, b) => (b.filedDate || '').localeCompare(a.filedDate || ''));
  const top = filings.slice(0, 12);

  // Generate Gemini TLDRs for all filings in one batch call
  const tldrs = await generateTldrs(gemKey, top);
  top.forEach((f, i) => {
    if (tldrs[i]) f.tldr = tldrs[i];
    delete f.filedDate; // don't expose raw date to client — `when` is enough
  });

  if (kv && top.length && top.some(f => f.tldr)) {
    try {
      await kv.put(cacheKey, JSON.stringify(top), { expirationTtl: CACHE_TTL });
    } catch (_) {}
  }

  return Response.json(top);
}
