/**
 * GET /api/wire?tickers=AMZN,MSFT,...
 *
 * Returns a live news wire by merging:
 *   1. Finnhub general market news (broad macro/market items)
 *   2. Tavily search queries for each ticker + macro terms
 *
 * Response shape matches WIRE_SEED:
 *   [{ tag, ticker_or_sector, source, ago, headline, severity }, ...]
 */

const MACRO_TERMS = ["yield curve", "Federal Reserve", "inflation", "CPI", "S&P 500", "interest rates"];
const SECTOR_MAP = {
  AMZN: "Cons. Disc.", ANET: "Tech", EME: "Industrials", MPWR: "Tech",
  MRVL: "Tech", PENG: "Tech", SKWD: "Financials", AVGO: "Tech",
  GOOG: "Tech", MSFT: "Tech", MU: "Tech", NOW: "Tech",
  RDDT: "Comm.", NVDA: "Tech", AAPL: "Tech", META: "Tech",
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function scoreSeverity(headline) {
  const h = headline.toLowerCase();
  if (/plunge|crash|collapse|warning|probe|doj|sec.{0,10}investi|recall|crisis|downgrade|miss|cut guidance/.test(h)) return "warn";
  if (/surge|record|beat|raised guidance|new high|bull|upgrade/.test(h)) return "info";
  return "info";
}

async function fetchFinnhubGeneralNews(apiKey) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&minId=0&token=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 10).map(n => ({
      tag: "MACRO",
      ticker_or_sector: "MACRO",
      source: n.source || "Finnhub",
      ago: timeAgo(new Date(n.datetime * 1000).toISOString()),
      headline: (n.headline || "").slice(0, 120),
      severity: scoreSeverity(n.headline || ""),
    }));
  } catch {
    return [];
  }
}

async function fetchTavilyItems(tickers, apiKey) {
  const results = [];

  // Ticker-specific queries (top 4 tickers)
  const topTickers = tickers.slice(0, 4);
  for (const ticker of topTickers) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: `${ticker} stock news today`,
          search_depth: "basic",
          max_results: 2,
          include_answer: false,
          include_raw_content: false,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data.results)) continue;
      data.results.forEach(r => {
        const headline = (r.title || "").slice(0, 120);
        if (!headline) return;
        results.push({
          tag: "TICKER",
          ticker_or_sector: ticker,
          source: new URL(r.url || "https://unknown.com").hostname.replace("www.", ""),
          ago: r.published_date ? timeAgo(r.published_date) : "?",
          headline,
          severity: scoreSeverity(headline),
        });
      });
    } catch { /* skip */ }
  }

  // One macro query
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: "stock market macro economic news today Federal Reserve",
        search_depth: "basic",
        max_results: 3,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results)) {
        data.results.forEach(r => {
          const headline = (r.title || "").slice(0, 120);
          if (!headline) return;
          results.push({
            tag: "MACRO",
            ticker_or_sector: "MACRO",
            source: new URL(r.url || "https://unknown.com").hostname.replace("www.", ""),
            ago: r.published_date ? timeAgo(r.published_date) : "?",
            headline,
            severity: scoreSeverity(headline),
          });
        });
      }
    }
  } catch { /* skip */ }

  return results;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD");

  const fhKey = context.env.FINNHUB_API_KEY;
  const tvKey = context.env.TAVILY_API_KEY;

  if (!fhKey && !tvKey) {
    return new Response(JSON.stringify({ error: "No API keys configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [finnhubItems, tavilyItems] = await Promise.all([
    fhKey ? fetchFinnhubGeneralNews(fhKey) : Promise.resolve([]),
    tvKey && tickers.length > 0 ? fetchTavilyItems(tickers, tvKey) : Promise.resolve([]),
  ]);

  // Merge, deduplicate by headline prefix, cap at 12 items
  const seen = new Set();
  const merged = [...tavilyItems, ...finnhubItems].filter(item => {
    const key = item.headline.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);

  return new Response(JSON.stringify(merged), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120", // 2-min browser cache
    },
  });
}
