/**
 * GET /api/news?tickers=AMZN,MSFT,...
 *
 * Scored portfolio news.
 *
 * KV layout: ONE key per portfolio composition (sorted tickers).
 *   - 1 KV read per request  (was: N reads, one per ticker)
 *   - 1 KV write per refresh (was: N writes over multiple re-poll cycles)
 *
 * Scoring: ONE Gemma call covers all tickers in a single prompt.
 *   - Runs in waitUntil after response is sent (I/O time ≠ CPU time)
 *   - No per-ticker company-name lookups (saves N extra Finnhub calls)
 *   - Falls back to keyword heuristics if Gemma fails
 *
 * Flow:
 *   1. Read ONE KV key for the whole portfolio
 *   2. If fresh  → return immediately (200 OK, X-News-Status: fresh)
 *   3. If stale  → return stale items, trigger background refresh, status: scoring
 *   4. If absent → return [], trigger background refresh, status: scoring
 *   5. Frontend re-polls once after 60s; cache is warm thereafter
 */

import { geminiFetch, geminiKeys } from "./_gemini.js";
import { timeAgo, salvageArray, postNewsArchive, heuristicScore, heuristicSentiment, clipWord } from "./_util.js";

const CACHE_VERSION  = "news:portfolio:v1";
const CACHE_TTL_MS   = 45 * 60 * 1000;   // serve from cache for 45 min
const MAX_TICKERS    = 15;
const MAX_PER_TICKER = 5;                 // headlines per ticker sent to Gemma

const PREFLIGHT_NOISE = /^dow jones|^nasdaq|^s&p 500|futures (fall|rise|drop|surge)|week in review|weekly recap|top \d+ stocks?|best stocks? to buy|should you buy|buy or sell\??|is .{3,40} a (top|good) (stock|buy|invest)|small.cap|mid.cap|etf (could|may|might|is|are)|a (top|major|big) .{0,20}etf|ethereum|bitcoin|\bcrypto\b|market (wrap|recap|roundup|update)|premarket|pre-market|after.?hours|opening bell|closing bell/i;

function cacheKey(tickers) {
  return `${CACHE_VERSION}:${tickers.slice().sort().join(',')}`;
}

async function fetchTickerNews(sym, apiKey) {
  const today       = new Date().toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${twoWeeksAgo}&to=${today}&token=${apiKey}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data
      .slice(0, 10)
      .map(n => ({
        ticker:   sym,
        source:   n.source || "—",
        datetime: n.datetime || 0,
        ago:      timeAgo(n.datetime || 0),
        headline: clipWord(n.headline, 150),
        url:      n.url || null,
      }))
      .filter(n => {
        if (!n.headline || PREFLIGHT_NOISE.test(n.headline)) return false;
        const key = n.headline.slice(0, 70).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => heuristicScore(b.headline) - heuristicScore(a.headline))
      .slice(0, MAX_PER_TICKER);
  } catch { return []; }
}

// Score ALL tickers in ONE Gemma call.
async function scoreAll(allItems, tickers, env) {
  if (!allItems.length) return null;

  const numbered  = allItems.map((it, i) => `${i + 1}. [${it.ticker}] ${it.headline}`).join("\n");
  const tickerList = tickers.join(", ");

  const prompt = `You are a portfolio news scorer. Portfolio holdings: ${tickerList}.

Review these headlines fetched from company news feeds. Keep ONLY headlines whose PRIMARY subject is one of the portfolio tickers. Drop: articles mainly about other companies, ETFs, crypto, generic market roundups, price-only updates.

Output ONLY a valid JSON array — no markdown fences, no text before or after. For each headline you keep:
{"line": <1-based line number>, "ticker": "<portfolio ticker symbol>", "sentiment": "bull" or "bear" or "neutral", "importance": <integer 0-100>, "why": "<max 6 words>"}

importance scale: earnings beat/miss or guidance change 88-98 | analyst upgrade/downgrade with price target 72-85 | M&A or exec change 70-82 | product/regulatory 60-72 | general positive/negative 40-60 | routine low-signal 10-39

Headlines:
${numbered}`;

  try {
    const res = await geminiFetch(env, "gemma-4-31b-it:generateContent", {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    });
    if (!res?.ok) return null;
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const txt   = (parts.find(p => !p.thought) || parts[0] || {}).text || "";
    const scored = salvageArray(txt);
    if (!Array.isArray(scored)) return null;

    return scored.map(sc => {
      const lineNum = sc.line ?? sc.n ?? sc.number;
      const orig    = allItems[(lineNum || 0) - 1];
      if (!orig) return null;
      const impRaw  = sc.importance ?? sc.i;
      const imp     = parseInt(impRaw, 10);
      const sentRaw = (sc.sentiment || sc.s || '').toLowerCase();
      return {
        ticker:    (sc.ticker || orig.ticker || '').toUpperCase(),
        source:    orig.source,
        ago:       orig.ago,
        datetime:  orig.datetime,
        headline:  orig.headline,
        sentiment: ['bull','bear','neutral'].includes(sentRaw) ? sentRaw : heuristicSentiment(orig.headline),
        importance: !isNaN(imp) ? Math.min(100, Math.max(0, imp)) : heuristicScore(orig.headline),
        why:       clipWord(sc.why || sc.w, 60),
        url:       orig.url,
      };
    }).filter(Boolean);
  } catch { return null; }
}

// Fetch all news + score in one pass, then write ONE KV key.
async function refreshCache(env, tickers, key) {
  const fhKey = env.FINNHUB_API_KEY;
  if (!fhKey || !env.DD_KV) return;

  // Fetch all tickers in parallel — no company-name lookups needed
  const rawArrays = await Promise.all(tickers.map(sym => fetchTickerNews(sym, fhKey)));
  const allItems  = rawArrays.flat();

  if (!allItems.length) return;

  // One Gemma call for everything
  let items = geminiKeys(env).length ? await scoreAll(allItems, tickers, env) : null;

  // Heuristic fallback if Gemma unavailable or fails
  if (!items) {
    items = allItems.map(it => ({
      ...it,
      sentiment:  heuristicSentiment(it.headline),
      importance: heuristicScore(it.headline),
      why: '',
    }));
  }

  if (!items.length) return;

  // ONE KV write
  try {
    await env.DD_KV.put(
      key,
      JSON.stringify({ items, updatedAt: new Date().toISOString(), tickers }),
      { expirationTtl: 24 * 3600 }
    );
  } catch {}

  // Archive to Supabase (fire-and-forget)
  postNewsArchive(env, items.map(n => ({
    ticker:       n.ticker ?? null,
    tag:          'TICKER',
    source:       n.source ?? null,
    headline:     n.headline,
    why:          n.why ?? null,
    importance:   n.importance ?? null,
    severity:     null,
    url:          n.url ?? null,
    published_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
  }))).catch(() => {});
}

export async function onRequestGet(context) {
  const url        = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers    = tickerParam.split(",").map(t => t.trim().toUpperCase())
    .filter(Boolean).filter(t => t !== "USD").slice(0, MAX_TICKERS);

  if (!tickers.length || !context.env.DD_KV) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json", "X-News-Status": "fresh", "Cache-Control": "no-store" },
    });
  }

  const key = cacheKey(tickers);
  const now = Date.now();

  // ONE KV read for the whole portfolio
  let cached = null;
  try { cached = await context.env.DD_KV.get(key, "json"); } catch {}

  const age   = cached?.updatedAt ? now - new Date(cached.updatedAt).getTime() : Infinity;
  const fresh = cached?.items?.length && age < CACHE_TTL_MS;

  if (fresh) {
    return new Response(JSON.stringify(cached.items), {
      headers: { "Content-Type": "application/json", "X-News-Status": "fresh", "Cache-Control": "no-store" },
    });
  }

  // Stale or missing — refresh in background after sending response
  context.waitUntil(refreshCache(context.env, tickers, key));

  if (cached?.items?.length) {
    // Serve stale items immediately while refresh runs
    return new Response(JSON.stringify(cached.items), {
      headers: { "Content-Type": "application/json", "X-News-Status": "scoring", "Cache-Control": "no-store" },
    });
  }

  // No data yet — return empty, frontend will re-poll
  return new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json", "X-News-Status": "scoring", "Cache-Control": "no-store" },
  });
}
