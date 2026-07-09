/**
 * GET /api/wire?tickers=AMZN,MSFT,...
 *
 * Fetches raw news from Finnhub + Tavily, then passes everything through
 * Gemma to filter to material items only and correct attribution.
 * Results are KV-cached for 10 minutes.
 */

import { geminiFetch, geminiKeys } from "./_gemini.js";
import { timeAgo, postNewsArchive, heuristicScore, heuristicSentiment, clipWord, drain } from "./_util.js";

const CACHE_VERSION = "wire:feed:v8";
const CACHE_TTL_MS = 20 * 60 * 1000;

function cacheKey(tickers) {
  return `${CACHE_VERSION}:${tickers.slice().sort().join(',')}`;
}

async function fetchFinnhubGeneralNews(apiKey) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${apiKey}`,
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) { drain(res); return []; }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 15).map(n => ({
      source: n.source || "Finnhub",
      ago: timeAgo(new Date((n.datetime || 0) * 1000).toISOString()),
      datetime: n.datetime || 0,
      headline: clipWord(n.headline, 150),
      url: n.url || null,
      hint: "MACRO",
    }));
  } catch { return []; }
}

// Tavily keys, tried in order. Merges the legacy single TAVILY_API_KEY (kept as
// primary) with any extra/backup keys in the comma-separated TAVILY_API_KEYS, so
// adding a fallback is just setting one env var — no need to touch the primary.
function tavilyKeys(env) {
  const out = [];
  const push = k => { k = (k || "").trim(); if (k && !out.includes(k)) out.push(k); };
  push(env.TAVILY_API_KEY);
  (env.TAVILY_API_KEYS || "").split(",").forEach(push);
  return out;
}

// One Tavily search with key failover: try each key in order until one returns a
// usable (res.ok) response. Returns parsed JSON, or null if every key failed.
async function tavilySearch(keys, body) {
  for (const key of keys) {
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, api_key: key }),
      });
      if (r.ok) return await r.json();
      drain(r); // non-ok (401/403/429/5xx) — fall through to the next key
    } catch { /* network error — try next key */ }
  }
  return null;
}

async function fetchTavilyItems(tickers, keys) {
  const raw = [];

  // Query top 5 tickers in parallel
  const tickerQueries = tickers.slice(0, 5).map(ticker =>
    tavilySearch(keys, {
      query: `${ticker} earnings revenue analyst guidance 2026`,
      topic: "news",
      search_depth: "basic",
      max_results: 3,
      include_answer: false,
      include_raw_content: false,
      exclude_domains: ["finance.yahoo.com", "marketwatch.com", "robinhood.com", "wsj.com/market-data", "google.com"],
    })
    .then(data => {
      if (!data?.results) return;
      data.results.forEach(r => {
        const headline = clipWord(r.title, 150);
        if (!headline) return;
        let source = "unknown";
        try { source = new URL(r.url).hostname.replace("www.", ""); } catch {}
        raw.push({
          source,
          ago: r.published_date ? timeAgo(r.published_date) : "?",
          datetime: r.published_date ? Math.floor(new Date(r.published_date).getTime() / 1000) : 0,
          headline,
          url: r.url || null,
          hint: ticker,
        });
      });
    })
    .catch(() => {})
  );

  // One macro query
  const macroQuery = tavilySearch(keys, {
    query: "Federal Reserve interest rates earnings recession GDP inflation 2026",
    topic: "news",
    search_depth: "basic",
    max_results: 4,
    include_answer: false,
    include_raw_content: false,
    exclude_domains: ["finance.yahoo.com", "marketwatch.com", "robinhood.com"],
  })
  .then(data => {
    if (!data?.results) return;
    data.results.forEach(r => {
      const headline = clipWord(r.title, 150);
      if (!headline) return;
      let source = "unknown";
      try { source = new URL(r.url).hostname.replace("www.", ""); } catch {}
      raw.push({ source, ago: r.published_date ? timeAgo(r.published_date) : "?", datetime: r.published_date ? Math.floor(new Date(r.published_date).getTime() / 1000) : 0, headline, url: r.url || null, hint: "MACRO" });
    });
  })
  .catch(() => {});

  await Promise.all([...tickerQueries, macroQuery]);
  return raw;
}

async function filterWithGemma(rawItems, tickers, env) {
  if (rawItems.length === 0) return [];

  const tickerList = tickers.join(", ");
  const numbered = rawItems.map((item, i) =>
    `${i + 1}. [hint: ${item.hint}] "${item.headline}" (${item.source}, ${item.ago} ago)`
  ).join("\n");

  const prompt = `You are an editorial filter for a stock portfolio dashboard. The portfolio holds: ${tickerList}.

Below are raw news headlines fetched from various sources. Many are noise — generic market recaps, price-only updates, articles about companies NOT in the portfolio, or irrelevant content.

Your job: return ONLY headlines that are materially significant for an investor holding these specific stocks. Material means: earnings results, revenue/guidance changes, analyst upgrades/downgrades with price targets, M&A activity, major product launches, executive changes, regulatory/legal actions, or important macro data (Fed decisions, CPI, GDP).

For each item you keep:
- Set "tag" to "TICKER" if it's about a specific portfolio company, "MACRO" if it's a broad market/economic item, "SECTOR" if it's about a sector trend
- Set "ticker_or_sector" to the exact ticker symbol (e.g. "AMZN") for TICKER items, "MACRO" for macro, or sector name for SECTOR
- Only assign a ticker if the article is genuinely about that company — not just tangentially mentioning it
- Write a clean "headline" under 100 characters that captures the key fact
- Set "sentiment" to "bull" if positive/bullish for markets or the stock, "bear" if negative/bearish, "neutral" if informational with no clear direction
- "importance": integer 0–100 — how actionable for a portfolio investor:
    earnings beat/miss or guidance change → 88–98
    analyst upgrade/downgrade with PT     → 72–85
    exec departure or M&A                 → 70–82
    product launch / regulatory           → 60–72
    macro data (Fed, CPI, GDP)            → 55–75
    general positive/negative news        → 40–60
    routine / low signal                  → 10–39
- "why": ≤10 word phrase — the single most investor-relevant fact

Return ONLY a valid JSON array. No markdown fences, no explanation before or after. If nothing qualifies, return [].

Headlines to evaluate:
${numbered}`;

  try {
    // 12s cap — this runs in a waitUntil that production kills ~30s after the
    // response; a slow Gemma call must lose gracefully (heuristic items are
    // already written), not silently eat the whole budget.
    const res = await geminiFetch(env, "gemma-4-31b-it:generateContent", {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }, { timeoutMs: 12000 });
    if (!res || !res.ok) { drain(res); return null; }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const raw = (parts.find(p => !p.thought) || parts[0] || {}).text || "";

    // Extract JSON array robustly — works even if Gemma adds preamble/postamble text
    // or wraps in markdown code fences. Greedily match from first [ to last ].
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return null;
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return null;

    // Merge back the source/ago from the original items by matching headline prefix
    return parsed.map(item => {
      // Match by source (Gemma preserves it) + hint. Headline prefix is unreliable
      // because Gemma rewrites headlines.
      const orig = rawItems.find(r =>
          r.source?.toLowerCase() === (item.source || "").toLowerCase() &&
          (r.hint === item.ticker_or_sector || r.hint === "MACRO")
        ) || rawItems.find(r => r.source?.toLowerCase() === (item.source || "").toLowerCase())
          || rawItems.find(r => r.hint === item.ticker_or_sector || r.hint === "MACRO");

      const headline = clipWord(item.headline, 110);
      // Use Gemma's score if it's a real value; fall back to heuristic if Gemma skipped it
      const rawScore = parseInt(item.importance, 10);
      const importance = !isNaN(rawScore) ? Math.min(100, Math.max(0, rawScore)) : heuristicScore(headline);
      const sentRaw = (item.sentiment || "").toLowerCase();
      const sentiment = ['bull','bear','neutral'].includes(sentRaw) ? sentRaw : heuristicSentiment(headline);

      return {
        tag: item.tag || "TICKER",
        ticker_or_sector: item.ticker_or_sector || "—",
        source: orig?.source || "—",
        ago: orig?.ago || "?",
        datetime: orig?.datetime || 0,
        headline,
        sentiment,
        importance,
        why: clipWord(item.why, 80),
        url: orig?.url || null,
      };
    }).filter(item => item.headline);
  } catch { return null; }
}

async function archiveToSupabase(env, items) {
  const rows = (items || []).map(n => ({
    ticker:       n.tag === 'TICKER' ? (n.ticker_or_sector ?? null) : null,
    tag:          n.tag ?? 'MACRO',
    source:       n.source ?? null,
    headline:     n.headline,
    why:          n.why ?? null,
    importance:   n.importance ?? null,
    severity:     n.severity ?? null,
    url:          n.url ?? null,
    published_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
  }));
  await postNewsArchive(env, rows);
}

function wireResponse(items, status) {
  return new Response(JSON.stringify(items), {
    headers: {
      "Content-Type": "application/json",
      "X-News-Status": status,
      "Cache-Control": "no-store",
    },
  });
}

async function fetchRawWire(env, tickers) {
  const fhKey = env.FINNHUB_API_KEY;
  const tvKeys = tavilyKeys(env);

  // Fetch raw items in parallel
  const [finnhubItems, tavilyItems] = await Promise.all([
    fhKey ? fetchFinnhubGeneralNews(fhKey) : Promise.resolve([]),
    tvKeys.length && tickers.length > 0 ? fetchTavilyItems(tickers, tvKeys) : Promise.resolve([]),
  ]);

  // Deduplicate by headline prefix before sending to Gemma
  const seen = new Set();
  return [...tavilyItems, ...finnhubItems].filter(item => {
    const key = item.headline.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Keyword filter + heuristic scoring — the guaranteed-fast path.
function heuristicWireItems(allRaw) {
  const NOISE = /stock price|quote|buy or sell|market data|at a glance|weekly recap|week that was|today.*dow.*nasdaq|live updates/i;
  return allRaw
    .filter(r => !NOISE.test(r.headline))
    .slice(0, 12)
    .map(r => {
      const headline = clipWord(r.headline, 110);
      return {
        tag: r.hint === "MACRO" ? "MACRO" : "TICKER",
        ticker_or_sector: r.hint,
        source: r.source,
        ago: r.ago,
        datetime: r.datetime || 0,
        headline,
        importance: heuristicScore(headline),
        sentiment: heuristicSentiment(headline),
        why: "",
        url: r.url || null,
      };
    })
    .sort((a, b) => b.importance - a.importance);
}

async function buildWireItems(env, tickers) {
  const allRaw = await fetchRawWire(env, tickers);
  const items = geminiKeys(env).length ? await filterWithGemma(allRaw, tickers, env) : null;
  return items || heuristicWireItems(allRaw);
}

async function putWire(env, kvKey, items, pending) {
  try {
    await env.DD_KV.put(kvKey,
      JSON.stringify({ items, updatedAt: new Date().toISOString(),
                       ...(pending ? { pending: true } : {}) }),
      { expirationTtl: 3600 });
  } catch { /* served next poll from stale */ }
}

// Same waitUntil ~30s-kill defense as news.js refreshCache: production
// terminates background work ~30s after the response, SILENTLY — so write
// the fast heuristic items FIRST (the cache must exist even if we die
// mid-Gemma), then attempt the capped Gemma editorial pass as an upgrade.
async function refreshWire(env, tickers, kvKey) {
  try {
    const allRaw = await fetchRawWire(env, tickers);
    if (!allRaw.length) return;

    const heuristic = heuristicWireItems(allRaw);
    if (heuristic.length) await putWire(env, kvKey, heuristic, true);

    const filtered = geminiKeys(env).length ? await filterWithGemma(allRaw, tickers, env) : null;
    const items = filtered?.length ? filtered : heuristic;
    if (filtered?.length) await putWire(env, kvKey, filtered, false);

    await archiveToSupabase(env, items);
  } catch { /* next poll retries */ }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD");

  // No KV binding (bare local dev) — compute inline, old blocking behavior.
  if (!context.env.DD_KV) {
    return wireResponse(await buildWireItems(context.env, tickers), "fresh");
  }

  // Serve-stale + background-refresh, mirroring news.js: a cold call used to
  // block ~15-20s on Finnhub+Tavily+Gemma; now stale items (or []) return
  // immediately with X-News-Status: scoring and the frontend re-polls.
  const kvKey = cacheKey(tickers);
  let cached = null;
  try { cached = await context.env.DD_KV.get(kvKey, "json"); } catch { /* refresh below */ }

  const age = cached?.updatedAt ? Date.now() - new Date(cached.updatedAt).getTime() : Infinity;
  if (cached?.items?.length && age < CACHE_TTL_MS) {
    // A pending (heuristic-only) cache younger than 3 min may still get its
    // Gemma upgrade — report "scoring" so the client's re-poll picks it up.
    const upgrading = cached.pending && age < 3 * 60 * 1000;
    return wireResponse(cached.items, upgrading ? "scoring" : "fresh");
  }

  context.waitUntil(refreshWire(context.env, tickers, kvKey));
  return wireResponse(cached?.items || [], "scoring");
}
