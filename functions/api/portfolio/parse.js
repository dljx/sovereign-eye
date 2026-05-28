/**
 * POST /api/portfolio/parse
 *
 * Body (either form):
 *   { imageData: "<base64>", mimeType: "image/jpeg|png|webp|heic" }        // single
 *   { images: [{ imageData: "<base64>", mimeType: "..." }, ...] }          // multiple
 *
 * All images are sent to Gemini Vision in ONE request (so several screenshots
 * of a scrolled portfolio merge into one result, and we make one API call
 * instead of N — which avoids tripping the free-tier rate limit). Returns:
 *   { ok: true, broker: "IBKR"|"Tiger"|"Unknown", partial: bool, positions: [...] }
 *
 * Auth: Basic auth handled by _middleware.js
 */

const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_IMAGES = 6;

const EXTRACTION_PROMPT = `You are a financial data extraction assistant.
Extract all stock positions visible in this brokerage portfolio screenshot.

IBKR (Interactive Brokers) layout:
- Columns: INSTRUMENT (ticker + exchange label), CST BSS (total cost basis in USD),
  POS (number of shares held), LAST (current price), CHN (daily change %)
- IMPORTANT: "CST BSS" is the TOTAL cost basis, NOT per-share avg cost.
  Compute avg cost per share = CST BSS / POS.
  Example: AMZN CST BSS=9498, POS=40 → avg = 9498/40 = 237.45
- Ignore any BID/ASK panel, chart, or TODAY/52WK box at the bottom.

Tiger Brokers layout:
- English UI. Shows "My Portfolio(N)" heading.
- Each row: company name on top, "US" flag + ticker symbol below the name.
- Middle column: Position (shares) on top, market value below.
- Right column: Current price on top, Cost (avg cost per share) below.
- "Cost" IS the average cost per share — use it directly as "avg".
  Example: AVGO row shows 24 shares, Cost=373.41 → qty=24, avg=373.41

MULTIPLE IMAGES: You may receive several screenshots of the SAME portfolio
(e.g. a long list scrolled across images). Merge positions from ALL images and
DEDUPLICATE by ticker — each ticker must appear only once. If the same ticker
shows different values in two images, prefer the row with complete, larger data.

Return ONLY valid JSON (no markdown, no code fences):
{
  "broker": "IBKR" or "Tiger" or "Unknown",
  "partial": true or false,
  "positions": [
    { "ticker": "AMZN", "name": "Amazon.com Inc", "qty": 40, "avg": 237.45,
      "sector": "Consumer Discretionary", "industry": "E-commerce & Cloud" }
  ]
}

Rules:
- ticker: US exchange symbol uppercase (e.g. AMZN, AVGO, GOOG)
- qty: shares held, positive number (0 if not visible)
- avg: average cost per share in USD — compute CST BSS/POS for IBKR, read Cost directly for Tiger
- sector/industry: short labels from your training knowledge, empty string if uncertain
- partial: true if the screenshot appears to be a scrollable list that is cut off
- Ignore: cash/USD positions, money market, options, warrants, BID/ASK panels, charts
- Extract every visible equity position`;

export async function onRequestPost(context) {
  const gemKey = context.env.GEMINI_API_KEY;
  if (!gemKey) {
    return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalize to an array of images, supporting the legacy single-image body.
  let images = [];
  if (Array.isArray(body?.images)) {
    images = body.images;
  } else if (body?.imageData) {
    images = [{ imageData: body.imageData, mimeType: body.mimeType || "image/jpeg" }];
  }
  images = images
    .filter(im => im && typeof im.imageData === "string" && im.imageData.length >= 100)
    .map(im => ({ imageData: im.imageData, mimeType: VALID_MIME_TYPES.includes(im.mimeType) ? im.mimeType : "image/jpeg" }))
    .slice(0, MAX_IMAGES);

  if (!images.length) {
    return Response.json({ error: "Missing or invalid image(s)" }, { status: 400 });
  }

  const parts = images.map(im => ({ inlineData: { mimeType: im.mimeType, data: im.imageData } }));
  parts.push({ text: EXTRACTION_PROMPT });

  const callGemini = () => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${gemKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    }
  );

  let gemRes;
  try {
    gemRes = await callGemini();
    // One retry on rate-limit — the free tier can briefly 429 under load.
    if (gemRes.status === 429) {
      await new Promise(r => setTimeout(r, 2500));
      gemRes = await callGemini();
    }
  } catch (e) {
    return Response.json({ error: `Gemini fetch failed: ${String(e)}` }, { status: 502 });
  }

  if (!gemRes.ok) {
    const errText = await gemRes.text().catch(() => "");
    if (gemRes.status === 429) {
      return Response.json(
        { error: "Gemini rate limit (429) — the shared free-tier quota is momentarily exhausted. Wait ~30s and retry." },
        { status: 429 }
      );
    }
    return Response.json({ error: `Gemini ${gemRes.status}: ${errText.slice(0, 300)}` }, { status: 502 });
  }

  const gemData = await gemRes.json();
  const parts = gemData?.candidates?.[0]?.content?.parts || [];
  const rawText = (parts.find(p => !p.thought) || parts[0] || {}).text || "";

  const jsonStr = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return Response.json(
      { error: "Gemini returned non-parseable JSON", raw: rawText.slice(0, 500) },
      { status: 422 }
    );
  }

  const broker = parsed.broker || "Unknown";
  const byTicker = new Map();
  (parsed.positions || [])
    .filter(p => p.ticker && typeof p.ticker === "string" && p.ticker.trim())
    .map(p => ({
      ticker:   p.ticker.trim().toUpperCase(),
      name:     String(p.name || p.ticker).trim(),
      broker,
      qty:      Math.abs(+p.qty || 0),
      avg:      Math.abs(+p.avg || 0),
      sector:   String(p.sector || "").trim(),
      industry: String(p.industry || "").trim(),
    }))
    .filter(p => p.qty > 0)
    .forEach(p => {
      // Dedupe by ticker across images — keep the entry with the larger qty.
      const existing = byTicker.get(p.ticker);
      if (!existing || p.qty > existing.qty) byTicker.set(p.ticker, p);
    });

  return Response.json({ ok: true, broker, partial: !!parsed.partial, positions: [...byTicker.values()] });
}
