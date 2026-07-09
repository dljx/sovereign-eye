/**
 * GET /api/filings?tickers=AMZN,MSFT,...
 *
 * Returns recent SEC filings for portfolio tickers with Gemini TL;DRs and
 * direct SEC.gov links. Source: EDGAR itself (company Atom feeds) — Finnhub's
 * filings endpoint was lagging EDGAR by ~a week and its GOOG mapping is
 * frozen in 2016 (found 2026-07-09, when July 7 filings never appeared).
 * EDGAR is free, keyless, and current to the minute. KV-cached 60 minutes.
 */

import { geminiFetch, geminiKeys } from "./_gemini.js";
import { drain } from "./_util.js";

const CACHE_TTL  = 3600;
const MEANINGFUL = new Set(['8-K','10-Q','10-K','S-1','DEF 14A','6-K','10-K/A','8-K/A']);
const SEC_UA     = { 'User-Agent': 'SovereignEye/1.0 daryl.lee97@gmail.com' };

// ticker → zero-padded CIK, resolved once from SEC's canonical mapping and
// cached (only the requested tickers — the full file is ~900KB).
async function tickerCiks(kv, tickers) {
  const cacheK = `sec:ciks:v1:${[...tickers].sort().join(',')}`;
  if (kv) {
    try {
      const hit = await kv.get(cacheK, 'json');
      if (hit) return hit;
    } catch {}
  }
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json',
      { headers: SEC_UA, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { drain(r); return {}; }
    const all = await r.json();
    const want = new Set(tickers);
    const map = {};
    for (const e of Object.values(all)) {
      if (want.has(e.ticker)) map[e.ticker] = String(e.cik_str).padStart(10, '0');
    }
    if (kv) { try { await kv.put(cacheK, JSON.stringify(map), { expirationTtl: 7 * 86400 }); } catch {} }
    return map;
  } catch { return {}; }
}

// Parse an EDGAR company Atom feed into filing rows (regex — the feed is
// small and rigidly structured; a real XML parser isn't available here).
export function parseAtomFilings(xml) {
  const out = [];
  const entries = xml.split('<entry>').slice(1);
  for (const e of entries) {
    const type = (e.match(/<filing-type>([^<]+)<\/filing-type>/) || [])[1];
    const date = (e.match(/<filing-date>([^<]+)<\/filing-date>/) || [])[1];
    const href = (e.match(/<filing-href>([^<]+)<\/filing-href>/) || [])[1];
    if (type && date) out.push({ form: type.trim(), filedDate: date.trim(), url: (href || '').trim() });
  }
  return out;
}

async function fetchEdgarFilings(tk, cik) {
  try {
    const r = await fetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=exclude&count=20&output=atom`,
      { headers: SEC_UA, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { drain(r); return []; }
    return parseAtomFilings(await r.text());
  } catch { return []; }
}

function cleanHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchFilingSnippet(url) {
  if (!url) return '';
  const headers = SEC_UA;
  try {
    // EDGAR Atom hrefs point at the filing INDEX page — resolve to the
    // primary document via the directory listing first.
    if (/-index\.html?$/i.test(url)) {
      const dirUrl = url.slice(0, url.lastIndexOf('/') + 1);
      try {
        const idxRes = await fetch(`${dirUrl}index.json`, { headers, signal: AbortSignal.timeout(5000) });
        if (idxRes.ok) {
          const items = (await idxRes.json())?.directory?.item || [];
          const doc = items.find(f => /\.htm?$/i.test(f.name) && !/-index\.htm|^R\d+\.htm/i.test(f.name));
          if (doc?.name) url = `${dirUrl}${doc.name}`;
        } else { drain(idxRes); }
      } catch {}
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) { drain(res); return ''; }
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

async function generateTldrs(env, filings) {
  if (!geminiKeys(env).length || !filings.length) return [];

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
  // geminiFetch rotates across the key pool (failing over on 429) per model;
  // we still fall back across models if a model itself fails.
  for (const { model, config } of candidates) {
    try {
      const res = await geminiFetch(env, `${model}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: config,
      }, { timeoutMs: 20000 });
      if (!res || !res.ok) { drain(res); continue; }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const raw = (parts.find(p => !p.thought) || parts[0] || {}).text || '';
      const jsonStr = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed  = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch { continue; }
  }
  return [];
}

export async function onRequestGet(context) {
  const kv = context.env.DD_KV;

  const url     = new URL(context.request.url);
  // Dedupe (same ticker at two brokers) and take up to 20 — the old cap of 10
  // silently dropped a third of the portfolio once it grew past ten holdings.
  const tickers = [...new Set((url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase()))]
    .filter(t => /^[A-Z0-9.\-]{1,10}$/.test(t)).slice(0, 20);
  if (!tickers.length) return Response.json([]);

  const cacheKey = `sec:filings:v13:${[...tickers].sort().join(',')}`;

  // Serve cache (TLDR-less results are cached too, on a shorter TTL — the
  // old "only cache when a TLDR exists" gate re-hammered every upstream on
  // every poll whenever Gemini had a bad hour)
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, 'json');
      if (Array.isArray(cached) && cached.length) {
        return Response.json(cached, { headers: { 'X-Cache': 'HIT' } });
      }
    } catch (_) {}
  }

  // EDGAR company Atom feeds in parallel (keyless, current to the minute)
  const ciks = await tickerCiks(kv, tickers);
  const results = await Promise.all(
    tickers.map(async tk => ciks[tk] ? fetchEdgarFilings(tk, ciks[tk]) : [])
  );

  const filings = [];
  tickers.forEach((tk, i) => {
    results[i]
      .filter(f => MEANINGFUL.has(f.form))
      .slice(0, 2)
      .forEach(f => filings.push({
        form:       f.form,
        tk,
        tldr:       '',
        sent:       'neutral',
        when:       relDate(f.filedDate),
        filedDate:  f.filedDate || '',
        url:        f.url || '',
      }));
  });

  filings.sort((a, b) => (b.filedDate || '').localeCompare(a.filedDate || ''));
  const top = filings.slice(0, 12);

  // Generate Gemini TLDRs + sentiment for all filings in one batch call
  const tldrs = await generateTldrs(context.env, top);
  top.forEach((f, i) => {
    const r = tldrs[i];
    if (r?.tldr) f.tldr = r.tldr;
    if (r?.sent && ['bull','neutral','bear'].includes(r.sent)) f.sent = r.sent;
  });

  if (kv && top.length) {
    try {
      await kv.put(cacheKey, JSON.stringify(top),
        { expirationTtl: top.some(f => f.tldr) ? CACHE_TTL : 900 });
    } catch (_) {}
  }

  return Response.json(top);
}
