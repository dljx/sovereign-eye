/**
 * GET /api/filings?tickers=AMZN,MSFT,...
 *
 * Returns recent SEC filings for portfolio tickers via Finnhub,
 * with Gemini-generated TL;DRs and direct SEC.gov links.
 * KV-cached 60 minutes.
 */

const CACHE_TTL  = 3600;
const MEANINGFUL = new Set(['8-K','10-Q','10-K','S-1','DEF 14A','6-K','10-K/A','8-K/A']);

function cleanHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchFilingSnippet(url) {
  if (!url) return '';
  const headers = { 'User-Agent': 'SovereignEye/1.0 daryl.lee97@gmail.com' };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return '';
    const text = cleanHtml(await res.text());
    const itemIdx = text.search(/Item\s+\d/);
    const start = itemIdx > 0 ? itemIdx : 0;
    const snippet = text.slice(start, start + 1500);

    // Results 8-Ks: actual numbers are in Exhibit 99.1, not the body stub
    if (/\b99\.1\b|Exhibit\s+99|furnished\s+herewith/i.test(snippet)) {
      try {
        const dirUrl = url.slice(0, url.lastIndexOf('/') + 1);
        const mainFile = url.split('/').pop();
        const idxRes = await fetch(`${dirUrl}index.json`, { headers, signal: AbortSignal.timeout(5000) });
        if (idxRes.ok) {
          const items = (await idxRes.json())?.directory?.item || [];
          // Try exact pattern first, then fall back to any non-main non-viewer .htm file
          const ex99 =
            items.find(f => /ex.?99|exhibit.?99/i.test(f.name) && /\.htm?$/i.test(f.name)) ||
            items.find(f => /\.htm?$/i.test(f.name) && f.name !== mainFile && !/^R\d+\.htm/i.test(f.name));
          if (ex99?.name) {
            const exRes = await fetch(`${dirUrl}${ex99.name}`, { headers, signal: AbortSignal.timeout(6000) });
            if (exRes.ok) return cleanHtml(await exRes.text()).slice(0, 1500);
          }
        }
      } catch {}
    }

    return snippet;
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

  const candidates = [
    { model: 'gemini-3.5-flash', config: { temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } } },
    { model: 'gemma-4-31b-it',   config: { temperature: 0.2, maxOutputTokens: 8192 } },
  ];
  for (const { model, config } of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: config,
            }),
            signal: AbortSignal.timeout(45000),
          }
        );
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        if (!res.ok) break;
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const raw = (parts.find(p => !p.thought) || parts[0] || {}).text || '';
        const jsonStr = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
        const parsed  = JSON.parse(jsonStr);
        return Array.isArray(parsed) ? parsed : [];
      } catch { break; }
    }
  }
  return [];
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

  const cacheKey = `sec:filings:v12:${[...tickers].sort().join(',')}`;

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
  });

  if (kv && top.length && top.some(f => f.tldr)) {
    try {
      await kv.put(cacheKey, JSON.stringify(top), { expirationTtl: CACHE_TTL });
    } catch (_) {}
  }

  return Response.json(top);
}
