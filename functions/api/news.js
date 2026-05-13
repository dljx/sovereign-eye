/**
 * GET /api/news?tickers=AMZN,MSFT,...
 *
 * Fetches company-specific news from Finnhub for each ticker,
 * then runs Gemma to filter to material items and clean headlines.
 * KV-cached for 15 minutes.
 */

const CACHE_KEY = "news:feed";
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
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const raw = [];

  // Fetch up to 6 tickers sequentially (Finnhub rate limit)
  for (const sym of tickers.slice(0, 6)) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${weekAgo}&to=${today}&token=${apiKey}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data)) continue;
      data.slice(0, 5).forEach(n => {
        if (!n.headline) return;
        raw.push({
          ticker: sym,
          source: n.source || "—",
          datetime: n.datetime || 0,
          ago: timeAgo(n.datetime || 0),
          headline: (n.headline || "").slice(0, 150),
          url: n.url || "",
        });
      });
      await new Promise(r => setTimeout(r, 100));
    } catch {}
  }

  return raw.sort((a, b) => b.datetime - a.datetime);
}

async function filterWithGemma(rawItems, tickers, apiKey) {
  if (!apiKey || rawItems.length === 0) return null;

  const tickerList = tickers.join(", ");
  const numbered = rawItems.map((item, i) =>
    `${i + 1}. [${item.ticker}] "${item.headline}" (${item.source}, ${item.ago} ago)`
  ).join("\n");

  const prompt = `You are an editorial filter for a stock portfolio dashboard holding: ${tickerList}.

Filter the following company news headlines. Keep ONLY items with material investment significance: earnings results, revenue/EPS beats or misses, guidance changes, analyst upgrades/downgrades with price targets, M&A, major contracts, executive changes, regulatory actions, or significant product news.

Discard: generic daily market summaries, articles primarily about OTHER companies, price-only updates ("stock falls 2%"), speculative opinion pieces with no new facts, and duplicate stories.

For each kept item, return:
- "ticker": the exact ticker symbol
- "source": keep original
- "ago": keep original
- "headline": rewrite to under 90 characters, leading with the key fact
- "severity": "warn" for negative news, "info" for positive/neutral

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
    // Merge back datetime for proper sorting
    return parsed.map(item => {
      const orig = rawItems.find(r => r.ticker === item.ticker &&
        r.headline.slice(0, 30).toLowerCase() === (item.headline || "").slice(0, 30).toLowerCase())
        || rawItems.find(r => r.ticker === item.ticker);
      return {
        ticker: item.ticker || "—",
        source: item.source || orig?.source || "—",
        ago: item.ago || orig?.ago || "?",
        datetime: orig?.datetime || 0,
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

  if (tickers.length === 0) {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  const fhKey = context.env.FINNHUB_API_KEY;
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

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
