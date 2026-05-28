/**
 * GET /api/news?tickers=AMZN,MSFT,...
 *
 * Scored portfolio news. Gemma scoring is too slow (~20-30s/call) to fit
 * Cloudflare's ~30s waitUntil ceiling for the whole portfolio at once, so we
 * score PROGRESSIVELY: each request scores up to SCORE_BATCH stalest tickers
 * in the background and caches them per-ticker. The frontend re-polls until
 * every ticker is fresh; the cache then stays warm.
 *
 * Per-ticker scoring also fixes misattribution — each batch only keeps
 * articles whose primary subject is that ticker.
 */

const KEY_PREFIX = "news:tk:v15:";       // per-ticker KV key
const TICKER_TTL_MS = 45 * 60 * 1000;    // a ticker's scores are fresh for 45m
const SCORE_BATCH = 3;                    // tickers scored per request (fits <30s)
const MAX_TICKERS = 15;

const PREFLIGHT_NOISE = /^dow jones|^nasdaq|^s&p 500|futures (fall|rise|drop|surge)|week in review|weekly recap|top \d+ stocks?|best stocks? to buy|should you buy|buy or sell\??|is .{3,40} a (top|good) (stock|buy|invest)|small.cap|mid.cap|etf (could|may|might|is|are)|a (top|major|big) .{0,20}etf|ethereum|bitcoin|\bcrypto\b|market (wrap|recap|roundup|update)|premarket|pre-market|after.?hours|opening bell|closing bell/i;

function timeAgo(ts) {
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const tkKey = sym => KEY_PREFIX + sym;

function salvageArray(str) {
  let s = (str || "").replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try { return JSON.parse(s); } catch {}
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace > 0) {
    try { return JSON.parse(s.slice(0, lastBrace + 1) + "]"); } catch {}
  }
  return null;
}

// Fetch + pre-filter + de-dup one ticker's Finnhub news
async function fetchTickerNews(sym, apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${twoWeeksAgo}&to=${today}&token=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data
      .slice(0, 10)
      .map(n => ({
        ticker: sym,
        source: n.source || "—",
        datetime: n.datetime || 0,
        ago: timeAgo(n.datetime || 0),
        headline: (n.headline || "").slice(0, 150),
        url: n.url || null,
      }))
      .filter(n => {
        if (!n.headline || PREFLIGHT_NOISE.test(n.headline)) return false;
        const key = n.headline.slice(0, 70).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  } catch { return []; }
}

// Look up the company name for a ticker (so the model knows EME = EMCOR Group,
// not "Evolution Metals"). Returns null on failure.
async function fetchTickerName(sym, apiKey) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.name || "").trim() || null;
  } catch { return null; }
}

// Score one ticker (small, fast Gemma call with line-ref output)
async function scoreTicker(sym, companyName, items, apiKey) {
  if (!apiKey || !items || !items.length) return [];
  const who = companyName ? `${companyName} (ticker ${sym})` : sym;
  const numbered = items.map((it, i) => `${i + 1}. ${it.headline}`).join("\n");
  const prompt = `Score news for ${who}. The headlines below come from ${sym}'s news feed, but some may actually be about OTHER companies.
The ticker ${sym} refers specifically to ${who} — do NOT keep articles about other companies that merely share a similar name or ticker.
Keep ONLY headlines whose PRIMARY subject is ${who} itself. Drop anything mainly about another company, an ETF, crypto, or a market roundup.
Output ONLY a JSON array. Each item: {"n":<line number>,"s":"bull|bear|neutral","i":<importance 0-100>,"w":"<why, max 6 words>"}
importance guide: earnings/guidance 88-98, analyst rating w/ PT 72-85, M&A/exec 70-82, product/regulatory 60-72, general 40-60, routine 10-39.
${numbered}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const txt = (parts.find(p => !p.thought) || parts[0] || {}).text || "";
    const scored = salvageArray(txt) || [];
    return scored.map(sc => {
      const orig = items[(sc.n || 0) - 1];
      if (!orig) return null;
      const imp = parseInt(sc.i, 10);
      return {
        ticker: sym,
        source: orig.source,
        ago: orig.ago,
        datetime: orig.datetime,
        headline: orig.headline,
        sentiment: ['bull', 'bear', 'neutral'].includes((sc.s || '').toLowerCase()) ? (sc.s || '').toLowerCase() : 'neutral',
        importance: isNaN(imp) ? 50 : Math.min(100, Math.max(0, imp)),
        why: (sc.w || '').slice(0, 60),
        url: orig.url,
      };
    }).filter(Boolean);
  } catch { return []; }
}

// Background: score a small batch of tickers and cache each. Bounded < 30s.
async function scoreBatch(env, tickers) {
  const fhKey = env.FINNHUB_API_KEY;
  const gemKey = env.GEMINI_API_KEY;
  if (!fhKey || !gemKey) return;
  await Promise.all(tickers.map(async sym => {
    const [raw, name] = await Promise.all([fetchTickerNews(sym, fhKey), fetchTickerName(sym, fhKey)]);
    const scored = await scoreTicker(sym, name, raw, gemKey);
    if (!scored.length) return;
    try {
      await env.DD_KV.put(
        tkKey(sym),
        JSON.stringify({ items: scored, updatedAt: new Date().toISOString() }),
        { expirationTtl: 24 * 3600 }
      );
    } catch {}
    await archiveToSupabase(env, scored);
  }));
}

async function archiveToSupabase(env, items) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !items?.length) return;
  const rows = items.map(n => ({
    ticker:       n.ticker ?? null,
    tag:          'TICKER',
    source:       n.source ?? null,
    headline:     n.headline,
    why:          n.why ?? null,
    importance:   n.importance ?? null,
    severity:     n.severity ?? null,
    url:          n.url ?? null,
    published_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
  })).filter(r => r.headline);
  if (!rows.length) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/news_archive`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(rows),
    });
  } catch {}
}

function jsonResponse(items, status) {
  return new Response(JSON.stringify(items), {
    headers: {
      "Content-Type": "application/json",
      "X-News-Status": status, // fresh | scoring
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD").slice(0, MAX_TICKERS);

  if (tickers.length === 0) return jsonResponse([], "fresh");

  const fhKey = context.env.FINNHUB_API_KEY;
  const now = Date.now();

  // Read per-ticker scored caches in parallel
  const cached = await Promise.all(tickers.map(async sym => {
    if (!context.env.DD_KV) return null;
    try { return await context.env.DD_KV.get(tkKey(sym), "json"); } catch { return null; }
  }));

  const itemsByTicker = {};
  const stale = [];          // need (re)scoring
  const needFallback = [];   // nothing cached at all → show unscored placeholder
  tickers.forEach((sym, i) => {
    const c = cached[i];
    const fresh = c?.items?.length && c.updatedAt && (now - new Date(c.updatedAt).getTime()) < TICKER_TTL_MS;
    if (fresh) {
      itemsByTicker[sym] = c.items;
    } else {
      stale.push(sym);
      if (c?.items?.length) itemsByTicker[sym] = c.items; // stale but display it
      else needFallback.push(sym);
    }
  });

  // Unscored placeholders for tickers with no cache yet (so the panel isn't empty)
  if (needFallback.length && fhKey) {
    const raw = await Promise.all(needFallback.map(sym => fetchTickerNews(sym, fhKey)));
    needFallback.forEach((sym, i) => {
      itemsByTicker[sym] = raw[i].slice(0, 3).map(it => ({ ...it, sentiment: 'neutral', importance: 50, why: '' }));
    });
  }

  // Background: score the stalest batch (bounded so waitUntil finishes < 30s)
  if (stale.length) {
    context.waitUntil(scoreBatch(context.env, stale.slice(0, SCORE_BATCH)));
  }

  // Merge + dedupe + sort newest first
  const seen = new Set();
  const merged = Object.values(itemsByTicker).flat()
    .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
    .filter(it => {
      const key = it.headline.slice(0, 70).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return jsonResponse(merged, stale.length ? "scoring" : "fresh");
}
