/**
 * GET /api/news?tickers=AMZN,MSFT,...
 *
 * Returns scored portfolio news. Scoring (Gemma) is SLOW (~38s) and exceeds
 * the Cloudflare request budget, so it never runs in the response path.
 * Instead:
 *   - Fresh KV (< FRESH_TTL)  → served instantly
 *   - Stale KV (< STALE_TTL)  → served instantly, scores refreshed in background
 *   - Cold (no KV)            → unscored items served instantly, scored in background
 * Background work runs via context.waitUntil() using PARALLEL per-ticker Gemma
 * calls. Per-ticker scoring also fixes misattribution: each batch only keeps
 * articles whose primary subject is that ticker.
 */

const CACHE_KEY_PREFIX = "news:scored:v13:";
const FRESH_TTL_MS = 30 * 60 * 1000;   // serve directly, no refresh
const STALE_TTL_MS = 6 * 60 * 60 * 1000; // serve but refresh in background

const PREFLIGHT_NOISE = /^dow jones|^nasdaq|^s&p 500|futures (fall|rise|drop|surge)|week in review|weekly recap|top \d+ stocks?|best stocks? to buy|should you buy|buy or sell\??|is .{3,40} a (top|good) (stock|buy|invest)|small.cap|mid.cap|etf (could|may|might|is|are)|a (top|major|big) .{0,20}etf|ethereum|bitcoin|\bcrypto\b|market (wrap|recap|roundup|update)|premarket|pre-market|after.?hours|opening bell|closing bell/i;

function timeAgo(ts) {
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function cacheKeyFor(tickers) {
  return CACHE_KEY_PREFIX + [...tickers].sort().join(",");
}

// Salvage a complete JSON array even if the model truncated the output
function salvageArray(str) {
  let s = (str || "").replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try { return JSON.parse(s); } catch {}
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace > 0) {
    try { return JSON.parse(s.slice(0, lastBrace + 1) + "]"); } catch {}
  }
  return null;
}

// Fetch Finnhub company news grouped by ticker, pre-filtered and de-duped per ticker
async function fetchFinnhubByTicker(tickers, apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const out = {};
  await Promise.all(
    tickers.slice(0, 8).map(async sym => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${twoWeeksAgo}&to=${today}&token=${apiKey}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        const seen = new Set();
        out[sym] = data
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
      } catch {}
    })
  );
  return out;
}

// Score one ticker's headlines with a small, fast Gemma call (line-ref output)
async function scoreTicker(sym, items, apiKey) {
  if (!apiKey || !items || !items.length) return [];
  const numbered = items.map((it, i) => `${i + 1}. ${it.headline}`).join("\n");
  const prompt = `Score news for ${sym}. The headlines below come from ${sym}'s news feed, but some may actually be about OTHER companies.
Keep ONLY headlines whose PRIMARY subject is ${sym} itself. Drop anything mainly about another company, an ETF, crypto, or a market roundup.
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
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
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

// Background: fetch + parallel-score + merge + write KV. Not bound by response time.
async function refreshScores(env, tickers) {
  const fhKey = env.FINNHUB_API_KEY;
  const gemKey = env.GEMINI_API_KEY;
  if (!fhKey || !gemKey) return;
  const byTicker = await fetchFinnhubByTicker(tickers, fhKey);
  const perTicker = await Promise.all(
    tickers.map(sym => scoreTicker(sym, byTicker[sym], gemKey))
  );
  const seen = new Set();
  const items = perTicker.flat()
    .sort((a, b) => b.datetime - a.datetime)
    .filter(it => {
      const key = it.headline.slice(0, 70).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!items.length) return;
  try {
    await env.DD_KV.put(
      cacheKeyFor(tickers),
      JSON.stringify({ items, updatedAt: new Date().toISOString() }),
      { expirationTtl: 24 * 3600 }
    );
  } catch {}
  await archiveToSupabase(env, items);
}

// Cold-start: fast unscored items so the panel shows something immediately
async function unscoredFallback(tickers, fhKey) {
  if (!fhKey) return [];
  const byTicker = await fetchFinnhubByTicker(tickers, fhKey);
  const seen = new Set();
  return Object.values(byTicker).flat()
    .sort((a, b) => b.datetime - a.datetime)
    .filter(it => {
      const key = it.headline.slice(0, 70).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map(it => ({ ...it, sentiment: 'neutral', importance: 50, why: '' }));
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
      "X-News-Status": status, // fresh | stale | scoring
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD");

  if (tickers.length === 0) {
    return jsonResponse([], "fresh");
  }

  const fhKey = context.env.FINNHUB_API_KEY;
  const key = cacheKeyFor(tickers);

  // Read KV
  let cached = null;
  if (context.env.DD_KV) {
    try { cached = await context.env.DD_KV.get(key, "json"); } catch {}
  }

  if (cached?.items?.length && cached.updatedAt) {
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    if (age < FRESH_TTL_MS) {
      return jsonResponse(cached.items, "fresh");
    }
    if (age < STALE_TTL_MS) {
      // Serve stale immediately, refresh scores in background
      context.waitUntil(refreshScores(context.env, tickers));
      return jsonResponse(cached.items, "stale");
    }
  }

  // Cold (or very stale): return unscored items now, score in background
  const fallback = await unscoredFallback(tickers, fhKey);
  context.waitUntil(refreshScores(context.env, tickers));
  return jsonResponse(fallback, "scoring");
}
