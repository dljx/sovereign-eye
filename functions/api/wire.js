/**
 * GET /api/wire?tickers=AMZN,MSFT,...
 *
 * Fetches raw news from Finnhub + Tavily, then passes everything through
 * Gemma to filter to material items only and correct attribution.
 * Results are KV-cached for 10 minutes.
 */

const CACHE_KEY = "wire:feed:v6";
const CACHE_TTL_MS = 10 * 60 * 1000;

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

async function fetchFinnhubGeneralNews(apiKey) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${apiKey}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 15).map(n => ({
      source: n.source || "Finnhub",
      ago: timeAgo(new Date((n.datetime || 0) * 1000).toISOString()),
      datetime: n.datetime || 0,
      headline: (n.headline || "").slice(0, 150),
      url: n.url || null,
      hint: "MACRO",
    }));
  } catch { return []; }
}

async function fetchTavilyItems(tickers, apiKey) {
  const raw = [];

  // Query top 5 tickers in parallel
  const tickerQueries = tickers.slice(0, 5).map(ticker =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${ticker} earnings revenue analyst guidance 2026`,
        topic: "news",
        search_depth: "basic",
        max_results: 3,
        include_answer: false,
        include_raw_content: false,
        exclude_domains: ["finance.yahoo.com", "marketwatch.com", "robinhood.com", "wsj.com/market-data", "google.com"],
      }),
    })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data?.results) return;
      data.results.forEach(r => {
        const headline = (r.title || "").slice(0, 150);
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
  const macroQuery = fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: "Federal Reserve interest rates earnings recession GDP inflation 2026",
      topic: "news",
      search_depth: "basic",
      max_results: 4,
      include_answer: false,
      include_raw_content: false,
      exclude_domains: ["finance.yahoo.com", "marketwatch.com", "robinhood.com"],
    }),
  })
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (!data?.results) return;
    data.results.forEach(r => {
      const headline = (r.title || "").slice(0, 150);
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

async function filterWithGemma(rawItems, tickers, apiKey) {
  if (!apiKey || rawItems.length === 0) return [];

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

Return ONLY a JSON array (no markdown, no explanation). If nothing qualifies, return [].

Headlines to evaluate:
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
    // Merge back the source/ago from the original items by matching headline prefix
    return parsed.map(item => {
      // Match by source (Gemma preserves it) + hint. Headline prefix is unreliable
      // because Gemma rewrites headlines.
      const orig = rawItems.find(r =>
          r.source?.toLowerCase() === (item.source || "").toLowerCase() &&
          (r.hint === item.ticker_or_sector || r.hint === "MACRO")
        ) || rawItems.find(r => r.source?.toLowerCase() === (item.source || "").toLowerCase())
          || rawItems.find(r => r.hint === item.ticker_or_sector || r.hint === "MACRO");
      return {
        tag: item.tag || "TICKER",
        ticker_or_sector: item.ticker_or_sector || "—",
        source: orig?.source || "—",
        ago: orig?.ago || "?",
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
    ticker:       n.tag === 'TICKER' ? (n.ticker_or_sector ?? null) : null,
    tag:          n.tag ?? 'MACRO',
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

  const fhKey = context.env.FINNHUB_API_KEY;
  const tvKey = context.env.TAVILY_API_KEY;
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
            headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=180" },
          });
          context.waitUntil(cache.put(cacheKey, kvHit.clone()));
          return kvHit;
        }
      }
    } catch {}
  }

  // Fetch raw items in parallel
  const [finnhubItems, tavilyItems] = await Promise.all([
    fhKey ? fetchFinnhubGeneralNews(fhKey) : Promise.resolve([]),
    tvKey && tickers.length > 0 ? fetchTavilyItems(tickers, tvKey) : Promise.resolve([]),
  ]);

  // Deduplicate by headline prefix before sending to Gemma
  const seen = new Set();
  const allRaw = [...tavilyItems, ...finnhubItems].filter(item => {
    const key = item.headline.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Run Gemma editorial filter
  let items = gemKey ? await filterWithGemma(allRaw, tickers, gemKey) : null;

  // Fallback: basic keyword filter if Gemma fails
  if (!items) {
    const NOISE = /stock price|quote|buy or sell|market data|at a glance|weekly recap|week that was|today.*dow.*nasdaq|live updates/i;
    items = allRaw
      .filter(r => !NOISE.test(r.headline))
      .slice(0, 8)
      .map(r => ({
        tag: r.hint === "MACRO" ? "MACRO" : "TICKER",
        ticker_or_sector: r.hint,
        source: r.source,
        ago: r.ago,
        headline: r.headline.slice(0, 110),
        severity: "info",
      }));
  }

  // Cache result
  if (context.env.DD_KV && items.length > 0) {
    try {
      await context.env.DD_KV.put(CACHE_KEY, JSON.stringify({ items, updatedAt: new Date().toISOString() }), { expirationTtl: 3600 });
    } catch {}
  }

  const freshResponse = new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=180" },
  });
  context.waitUntil(cache.put(cacheKey, freshResponse.clone()));
  context.waitUntil(archiveToSupabase(context.env, items));
  return freshResponse;
}
