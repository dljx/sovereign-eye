/**
 * GET /api/news?tickers=AMZN,MSFT,...
 *
 * Fetches company-specific news from Finnhub for each ticker,
 * then runs Gemma to filter to material items and clean headlines.
 * KV-cached for 15 minutes.
 */

const CACHE_KEY = "news:feed:v8";
const CACHE_TTL_MS = 15 * 60 * 1000;

function timeAgo(ts) {
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

async function fetchFinnhubCompanyNews(tickers, apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

  // Fetch all tickers in parallel
  const results = await Promise.all(
    tickers.slice(0, 8).map(async sym => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${twoWeeksAgo}&to=${today}&token=${apiKey}`
        );
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.slice(0, 8).map(n => ({
          ticker: sym,
          source: n.source || "—",
          datetime: n.datetime || 0,
          ago: timeAgo(n.datetime || 0),
          headline: (n.headline || "").slice(0, 150),
          url: n.url || null,
        })).filter(n => n.headline);
      } catch { return []; }
    })
  );

  return results.flat().sort((a, b) => b.datetime - a.datetime);
}

async function filterWithGemma(rawItems, tickers, apiKey) {
  if (!apiKey || rawItems.length === 0) return null;

  const tickerList = tickers.join(", ");
  const numbered = rawItems.map((item, i) =>
    `${i + 1}. [${item.ticker}] "${item.headline}" (${item.source}, ${item.ago} ago)`
  ).join("\n");

  const prompt = `You are an editorial filter for a stock portfolio dashboard. Portfolio tickers: ${tickerList}.

Each headline below is tagged with the ticker whose Finnhub feed it came from, but that tag may be WRONG — Finnhub sometimes returns articles that only mention a stock in passing.

Your job:
1. Identify the PRIMARY company the article is actually about (the main subject of the headline).
2. If that primary company is one of the portfolio tickers, keep it and set "ticker" to that portfolio symbol.
3. If the primary company is NOT in the portfolio — even if a portfolio ticker is mentioned in passing — DISCARD the article.
4. Discard pure price-recap articles ("stock up 2%", "week in review"), obvious duplicates, and generic market roundups with no specific portfolio company as the subject.

Examples of correct behaviour:
- "[AMZN] Why The Market Is Re-Rating Google Stock" → primary subject is GOOG → discard (GOOG not in portfolio) OR reassign to GOOG if it is
- "[AMZN] Cisco Is Up 17%... like Arista Networks" → primary subject is Cisco → discard unless CSCO is in portfolio
- "[MRVL] Everyone's Talking About Micron" → primary subject is Micron → discard unless MU is in portfolio

For each KEPT item return:
- "ticker": the PRIMARY portfolio ticker this article is about
- "orig_ticker": the original bracket ticker from the input line
- "source": keep original
- "ago": keep original
- "headline": rewrite concisely under 90 characters, leading with the key fact
- "sentiment": "bull" if the news is positive/bullish for the stock, "bear" if negative/bearish, "neutral" if informational with no clear price direction
- "importance": integer 0–100 — how actionable is this for a portfolio investor:
    earnings beat/miss or guidance change → 88–98
    analyst upgrade/downgrade with PT     → 72–85
    exec departure or M&A                 → 70–82
    product launch / regulatory           → 60–72
    general positive/negative news        → 40–60
    routine / low signal                  → 10–39
- "why": ≤10 word phrase — the single most investor-relevant fact (e.g. "Beat EPS by 12%, raised FY guidance")

Return ONLY a JSON array. If nothing qualifies, return [].

Headlines:
${numbered}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const raw = (parts.find(p => !p.thought) || parts[0] || {}).text || "";
    const jsonStr = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    // Hard-filter: only keep items whose assigned ticker is actually in the portfolio
    const validSet = new Set(tickers);
    const kept = parsed.filter(item => item.ticker && validSet.has(item.ticker));
    // Merge back datetime/url. Use orig_ticker (the Finnhub source ticker) for the lookup
    // since Gemma may have reassigned ticker to a different portfolio symbol.
    return kept.map(item => {
      const origTk = item.orig_ticker || item.ticker;
      const orig = rawItems.find(r =>
          r.ticker === origTk &&
          r.source?.toLowerCase() === (item.source || "").toLowerCase()
        ) || rawItems.find(r => r.ticker === origTk)
          || rawItems.find(r => r.source?.toLowerCase() === (item.source || "").toLowerCase());
      return {
        ticker: item.ticker,
        source: item.source || orig?.source || "—",
        ago: item.ago || orig?.ago || "?",
        datetime: orig?.datetime || 0,
        headline: (item.headline || "").slice(0, 110),
        sentiment: ['bull','bear','neutral'].includes(item.sentiment) ? item.sentiment : 'neutral',
        importance: typeof item.importance === "number" ? Math.min(100, Math.max(0, Math.round(item.importance))) : 50,
        why: (item.why || "").slice(0, 80),
        url: orig?.url || null,
      };
    }).filter(item => item.headline);
  } catch { return null; }
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
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD");

  if (tickers.length === 0) {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  const fhKey = context.env.FINNHUB_API_KEY;
  const gemKey = context.env.GEMINI_API_KEY;

  // Workers edge cache (URL-only key — auth already validated by middleware)
  const cacheKey = new Request(url.toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  // Check KV cache
  if (context.env.DD_KV) {
    try {
      const cached = await context.env.DD_KV.get(CACHE_KEY, "json");
      if (cached?.items && cached.updatedAt) {
        const age = Date.now() - new Date(cached.updatedAt).getTime();
        if (age < CACHE_TTL_MS) {
          const kvHit = new Response(JSON.stringify(cached.items), {
            headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300" },
          });
          context.waitUntil(cache.put(cacheKey, kvHit.clone()));
          return kvHit;
        }
      }
    } catch {}
  }

  const rawItems = fhKey ? await fetchFinnhubCompanyNews(tickers, fhKey) : [];

  // Run Gemma filter
  let items = gemKey ? await filterWithGemma(rawItems, tickers, gemKey) : null;

  // Fallback: basic noise filter
  if (!items) {
    const NOISE = /stock price|quote|at a glance|week that was|live updates|buy or sell/i;
    items = rawItems.filter(r => !NOISE.test(r.headline)).slice(0, 8);
  }

  if (context.env.DD_KV && items.length > 0) {
    try {
      await context.env.DD_KV.put(CACHE_KEY, JSON.stringify({ items, updatedAt: new Date().toISOString() }), { expirationTtl: 3600 });
    } catch {}
  }

  const freshResponse = new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300" },
  });
  context.waitUntil(cache.put(cacheKey, freshResponse.clone()));
  context.waitUntil(archiveToSupabase(context.env, items));
  return freshResponse;
}
