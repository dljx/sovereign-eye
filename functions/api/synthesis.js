/**
 * GET /api/synthesis?tickers=AMZN,MSFT,...
 *
 * Returns Gemini-generated portfolio synthesis:
 *   { catalysts: [...], risks: [...], macro: [...], cached: bool, updatedAt: ISO }
 *
 * Flow:
 *   1. Check KV for cached synthesis (max 30 min old)
 *   2. If stale/missing: fetch recent headlines from Finnhub, prompt Gemini, store in KV
 *   3. Return result
 */

const CACHE_KEY = "dd:synthesis";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function fetchHeadlines(tickers, fhKey) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const headlines = [];

  // Finnhub general market news
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${fhKey}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.slice(0, 8).forEach(n => {
          if (n.headline) headlines.push(`[MARKET] ${n.headline}`);
        });
      }
    }
  } catch { /* skip */ }

  // Company-specific news for top tickers
  const top = tickers.slice(0, 5);
  for (const sym of top) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${weekAgo}&to=${today}&token=${fhKey}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.slice(0, 3).forEach(n => {
            if (n.headline) headlines.push(`[${sym}] ${n.headline}`);
          });
        }
      }
      await new Promise(r => setTimeout(r, 100));
    } catch { /* skip */ }
  }

  return headlines.slice(0, 30);
}

async function callGemini(tickers, headlines, apiKey) {
  const tickerList = tickers.join(", ");
  const headlineBlock = headlines.map((h, i) => `${i + 1}. ${h}`).join("\n");

  const prompt = `You are a portfolio analyst. Based on the news headlines below, generate a concise intelligence synthesis for a portfolio holding: ${tickerList}.

Return ONLY a JSON object with this exact structure (no markdown, no commentary):
{
  "catalysts": ["<3 forward-looking bullish catalysts relevant to these holdings>", "...", "..."],
  "risks": ["<3 key risks or headwinds relevant to these holdings>", "...", "..."],
  "macro": ["<3 macro-level observations affecting the portfolio>", "...", "..."]
}

Each bullet should be 1–2 sentences, specific to the actual holdings, reference ticker symbols where relevant.

Recent headlines:
${headlineBlock}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        thinkingConfig: { thinkingBudget: 0 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Strip markdown code fences if present
  const jsonStr = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  return JSON.parse(jsonStr);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tickerParam = url.searchParams.get("tickers") || "";
  const tickers = tickerParam.split(",").map(t => t.trim()).filter(Boolean).filter(t => t !== "USD");

  const fhKey = context.env.FINNHUB_API_KEY;
  const gemKey = context.env.GEMINI_API_KEY;

  if (!gemKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Try KV cache
  if (context.env.DD_KV) {
    try {
      const cached = await context.env.DD_KV.get(CACHE_KEY, "json");
      if (cached && cached.updatedAt) {
        const age = Date.now() - new Date(cached.updatedAt).getTime();
        if (age < CACHE_TTL_MS) {
          return new Response(JSON.stringify({ ...cached, cached: true }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }
      }
    } catch { /* proceed to refresh */ }
  }

  // 2. Fetch headlines + call Gemini
  const headlines = fhKey ? await fetchHeadlines(tickers, fhKey) : [];

  let synthesis;
  try {
    synthesis = await callGemini(tickers, headlines, gemKey);
  } catch (e) {
    // If Gemini fails, return a 502 so frontend falls back to seed
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = {
    ...synthesis,
    cached: false,
    updatedAt: new Date().toISOString(),
  };

  // 3. Store in KV
  if (context.env.DD_KV) {
    try {
      await context.env.DD_KV.put(CACHE_KEY, JSON.stringify(result), { expirationTtl: 3600 });
    } catch { /* non-fatal */ }
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
