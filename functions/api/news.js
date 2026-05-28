/**
 * GET /api/news?tickers=AMZN,MSFT,...
 *
 * Fetches company-specific news from Finnhub for each ticker,
 * then runs Gemma to filter to material items and clean headlines.
 * KV-cached for 30 minutes.
 */

const CACHE_KEY = "news:feed:v12";
const CACHE_TTL_MS = 30 * 60 * 1000;

// Headlines containing these patterns are generic market noise — discard before Gemma
const PREFLIGHT_NOISE = /^dow jones|^nasdaq|^s&p 500|futures (fall|rise|drop|surge)|week in review|weekly recap|top \d+ stocks?|best stocks? to buy|should you buy|buy or sell\??|is .{3,40} a (top|good) (stock|buy|invest)|small.cap|mid.cap|etf (could|may|might|is|are)|a (top|major|big) .{0,20}etf|ethereum|bitcoin|\bcrypto\b|market (wrap|recap|roundup|update)|premarket|pre-market|after.?hours|opening bell|closing bell/i;

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

  const results = await Promise.all(
    tickers.slice(0, 8).map(async sym => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${twoWeeksAgo}&to=${today}&token=${apiKey}`
        );
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data
          .slice(0, 12)
          .map(n => ({
            ticker: sym,
            source: n.source || "—",
            datetime: n.datetime || 0,
            ago: timeAgo(n.datetime || 0),
            headline: (n.headline || "").slice(0, 150),
            url: n.url || null,
          }))
          .filter(n => n.headline && !PREFLIGHT_NOISE.test(n.headline));
      } catch { return []; }
    })
  );

  // Deduplicate across tickers by headline prefix
  const seen = new Set();
  return results.flat()
    .sort((a, b) => b.datetime - a.datetime)
    .filter(item => {
      const key = item.headline.slice(0, 70).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function filterWithGemma(rawItems, tickers, apiKey) {
  if (!apiKey || rawItems.length === 0) return null;

  const tickerList = tickers.join(", ");
  const numbered = rawItems.map((item, i) =>
    `${i + 1}. [${item.ticker}] "${item.headline}" (${item.source}, ${item.ago} ago)`
  ).join("\n");

  const prompt = `You are an editorial filter for a stock portfolio dashboard. Portfolio tickers: ${tickerList}.

Each headline is tagged with the Finnhub source ticker, but that tag is OFTEN WRONG. Finnhub returns off-topic articles in a company's feed.

STRICT RULES — apply all of them:
1. Identify the PRIMARY company the article is actually about (the main subject of the headline).
2. Keep it ONLY if the primary subject is one of the portfolio tickers above.
3. DISCARD if the primary subject is any other company, ETF, index, or unnamed entity — even if a portfolio ticker is mentioned in passing.
4. DISCARD any article whose headline does not exclusively focus on one portfolio company.
5. DISCARD roundups, rankings, or comparison articles ("Top stocks", "Best buys", "X vs Y", "like NVDA").

ALWAYS DISCARD — no exceptions:
- Any article about an ETF, fund, or index (even if a portfolio company is named as a "beneficiary")
- Any article whose primary subject is a company NOT in the portfolio list
- Market roundup / macro articles ("Dow Jones", "S&P 500", "Nasdaq futures", "premarket", "closing bell")
- Crypto / commodity articles unless the portfolio explicitly holds crypto
- Articles asking "Is X a top stock?" or "Should you buy X?" where X is not a portfolio ticker
- Articles where the headline's main company is mentioned via a ticker in brackets but the article is actually about someone else

Examples:
- "[AVGO] Is Applied Materials (AMAT) a Top AI Semiconductor Stock?" → primary subject is AMAT → DISCARD (AMAT not in portfolio)
- "[AMZN] Standard Chartered Says Ethereum Could 20X" → crypto article → DISCARD
- "[MRVL] Dow Jones Futures Fall, Snowflake Surges On Earnings" → market roundup → DISCARD
- "[GOOG] A Big Wealth Manager Just Bought $22.4 Million Worth of This Small-Cap Value ETF" → ETF article → DISCARD
- "[GOOG] ByteDance making custom CPU chips" → primary subject is ByteDance → DISCARD
- "[MSFT] OpenAI signs deal with Oracle" → primary subject is OpenAI/Oracle → DISCARD
- "[AMZN] Amazon AWS beats estimates, raises guidance" → primary subject is AMZN → KEEP as AMZN

For each KEPT item return:
- "ticker": the PRIMARY portfolio ticker this article is about
- "orig_ticker": the original bracket ticker from the input
- "source": keep original
- "ago": keep original
- "headline": rewrite concisely under 90 characters, leading with the key fact
- "sentiment": "bull" | "bear" | "neutral"
- "importance": integer 0–100:
    earnings beat/miss or guidance change → 88–98
    analyst upgrade/downgrade with PT     → 72–85
    exec departure or M&A                 → 70–82
    product launch / regulatory           → 60–72
    general positive/negative news        → 40–60
    routine / low signal                  → 10–39
- "why": ≤10 word phrase — the single most investor-relevant fact

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
    const validSet = new Set(tickers);
    const kept = parsed.filter(item => item.ticker && validSet.has(item.ticker));
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
        sentiment: (['bull','bear','neutral'].includes((item.sentiment||'').toLowerCase()) ? (item.sentiment||'').toLowerCase() : 'neutral'),
        importance: (() => { const v = parseInt(item.importance, 10); return isNaN(v) ? 50 : Math.min(100, Math.max(0, v)); })(),
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

  const cacheKey = new Request(url.toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

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

  let items = gemKey ? await filterWithGemma(rawItems, tickers, gemKey) : null;

  // Fallback: basic noise filter (Gemma unavailable or failed)
  if (!items) {
    items = rawItems.slice(0, 8).map(r => ({
      ...r,
      sentiment: 'neutral',
      importance: 50,
      why: '',
    }));
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
