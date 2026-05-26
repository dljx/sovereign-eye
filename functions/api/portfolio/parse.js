/**
 * POST /api/portfolio/parse
 *
 * Body: { imageData: "<base64>", mimeType: "image/jpeg|png|webp|heic" }
 *
 * Sends the screenshot to Gemini Vision and returns extracted positions:
 *   { ok: true, broker: "IBKR"|"Tiger"|"Unknown", partial: bool, positions: [...] }
 *
 * Each position: { ticker, name, broker, qty, avg, sector, industry }
 *
 * Auth: Basic auth handled by _middleware.js
 */

const VALID_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

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

  const { imageData, mimeType = "image/jpeg" } = body || {};

  if (!imageData || typeof imageData !== "string" || imageData.length < 100) {
    return Response.json({ error: "Missing or invalid imageData" }, { status: 400 });
  }
  if (!VALID_MIME_TYPES.includes(mimeType)) {
    return Response.json({ error: `Unsupported mimeType: ${mimeType}` }, { status: 400 });
  }

  let gemRes;
  try {
    gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${gemKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: imageData } },
              { text: EXTRACTION_PROMPT },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      }
    );
  } catch (e) {
    return Response.json({ error: `Gemini fetch failed: ${String(e)}` }, { status: 502 });
  }

  if (!gemRes.ok) {
    const errText = await gemRes.text().catch(() => "");
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
  const positions = (parsed.positions || [])
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
    .filter(p => p.qty > 0);

  return Response.json({ ok: true, broker, partial: !!parsed.partial, positions });
}
