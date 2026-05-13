/**
 * GET /api/wire?tickers=AMZN,MSFT,...
 *
 * Fetches raw news from Finnhub + Tavily, then passes everything through
 * Gemma to filter to material items only and correct attribution.
 * Results are KV-cached for 10 minutes.
 */

const CACHE_KEY = "wire:feed";
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
      headline: (n.headline || "").slice(0, 150),
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
          headline,
          hint: ticker,  // which ticker this query was for
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
      raw.push({ source, ago: r.published_date ? timeAgo(r.published_date) : "?", headline, hint: "MACRO" });
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
- Set "severity" to "warn" for negative news, "info" for positive/neutral

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
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
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
      const orig = rawItems.find(r => r.headline.slice(0, 40).toLowerCase() === (item.headline || "").slice(0, 40).toLowerCase())
                || rawItems.find(r => r.hint === item.ticker_or_sector || r.hint === "MACRO");
      return {
        tag: item.tag || "TICKER",
        ticker_or_sector: item.ticker_or_sector || "—",
        source: orig?.source || "—",
        ago: orig?.ago || "?",
        headline: (item.headline || "").slice(0, 110),
        severity: item.severity || "info",
      };
    }).filter(item => item.headline);
  } catch { return null; }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD");

  const fhKey = context.env.FINNHUB_API_KEY;
  const tvKey = context.env.TAVILY_API_KEY;
  const gemKey = context.env.GEMINI_API_KEY;

  // Check KV cache
  if (context.env.DD_KV) {
    try {
      const cached = await context.env.DD_KV.get(CACHE_KEY, "json");
      if (cached?.items && cached.updatedAt) {
        const age = Date.now() - new Date(cached.updatedAt).getTime();
        if (age < CACHE_TTL_MS) {
          return new Response(JSON.stringify(cached.items), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
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

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
