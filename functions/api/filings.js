/**
 * GET /api/filings?tickers=AMZN,MSFT,...
 *
 * Returns recent SEC filings for portfolio tickers via Finnhub,
 * with Gemini-generated TL;DRs and direct SEC.gov links.
 * KV-cached 60 minutes.
 */

const CACHE_TTL  = 3600;
const MEANINGFUL = new Set(['8-K','10-Q','10-K','S-1','DEF 14A','6-K','10-K/A','8-K/A']);

async function fetchFilingSnippet(url) {
  if (!url) return '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SovereignEye/1.0 daryl.lee97@gmail.com' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    // Skip cover-page boilerplate — jump to first Item section
    const itemIdx = text.search(/Item\s+\d/);
    const start = itemIdx > 0 ? itemIdx : 0;
    return text.slice(start, start + 1500);
  } catch { return ''; }
}

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

  const snippets = await Promise.all(filings.map(f => fetchFilingSnippet(f.url)));

  const list = filings.map((f, i) => {
    const snip = snippets[i] ? `\n   [filing content: ${snippets[i]}]` : '';
    return `${i + 1}. ${f.tk} — ${f.form} filed ${f.filedDate || f.when}${snip}`;
  }).join('\n');

  const prompt = `You are a financial analyst. For each SEC filing below, write a concise 1-sentence TLDR (under 18 words) and assign a sentiment.

sentiment rules:
- "bull": filing discloses beat, raised guidance, strong revenue/earnings, positive catalyst, accretive deal
- "bear": filing discloses miss, lowered guidance, loss, lawsuit, dilutive offering, leadership departure, material weakness
- "neutral": proxy, routine annual report, in-line results, administrative filing with no clear directional signal

Return ONLY a JSON array of objects in the same order as the input. No markdown, no preamble.
[{ "tldr": "...", "sent": "bull" | "neutral" | "bear" }, ...]

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
          generationConfig: {
            temperature: 0.2,
            thinkingConfig: { thinkingLevel: "high" },
          },
        }),
        signal: AbortSignal.timeout(45000),
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

  const cacheKey = `sec:filings:v6:${[...tickers].sort().join(',')}`;

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

  // Generate Gemini TLDRs + sentiment for all filings in one batch call
  const tldrs = await generateTldrs(gemKey, top);
  top.forEach((f, i) => {
    const r = tldrs[i];
    if (r?.tldr) f.tldr = r.tldr;
    if (r?.sent && ['bull','neutral','bear'].includes(r.sent)) f.sent = r.sent;
    delete f.filedDate;
  });

  if (kv && top.length && top.some(f => f.tldr)) {
    try {
      await kv.put(cacheKey, JSON.stringify(top), { expirationTtl: CACHE_TTL });
    } catch (_) {}
  }

  return Response.json(top);
}
