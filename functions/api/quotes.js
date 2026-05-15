/**
 * GET /api/quotes?tickers=AMZN,GOOG,MSFT
 * Server-side Finnhub proxy — keeps the API key out of client JavaScript.
 * Requires FINNHUB_API_KEY env var set in Cloudflare Pages settings.
 *
 * Response: { AMZN: { c, d, dp, h, l, o, pc, v }, ... }
 */
const TICKER_RE = /^[A-Z]{1,10}$/;

export async function onRequestGet(context) {
  const key = context.env.FINNHUB_API_KEY;
  if (!key) {
    return Response.json({ error: "FINNHUB_API_KEY not configured" }, { status: 500 });
  }

  const url     = new URL(context.request.url);
  const raw     = url.searchParams.get("tickers") || "";
  const tickers = raw.split(",")
    .map(t => t.trim().toUpperCase())
    .filter(t => TICKER_RE.test(t))
    .slice(0, 30); // hard cap — free tier is 60 RPM

  if (!tickers.length) {
    return Response.json({});
  }

  const results = await Promise.all(
    tickers.map(t =>
      fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${key}`, {
        headers: { "User-Agent": "sovereign-eye" },
      })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const quotes = {};
  tickers.forEach((t, i) => {
    if (results[i]?.c > 0) quotes[t] = results[i];
  });

  return Response.json(quotes, {
    headers: { "Cache-Control": "no-store" },
  });
}
