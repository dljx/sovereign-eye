/**
 * GET /api/quotes?tickers=AMZN,GOOG,MSFT
 * Server-side Finnhub proxy — keeps the API key out of client JavaScript.
 * Requires FINNHUB_API_KEY env var set in Cloudflare Pages settings.
 *
 * Response: { AMZN: { c, d, dp, h, l, o, pc, v }, ... }
 */
const TICKER_RE = /^[A-Z]{1,10}$/;

export async function onRequestGet(context) {
  const key = (context.env.FINNHUB_API_KEY || "").trim();
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
    tickers.map(async t => {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${key}`, {
          headers: { "User-Agent": "sovereign-eye" },
        });
        if (!r.ok) return { _err: r.status };
        return await r.json();
      } catch (e) {
        return { _err: String(e) };
      }
    })
  );

  const quotes = {};
  tickers.forEach((t, i) => {
    const r = results[i];
    if (!r?._err && r?.c > 0) quotes[t] = r;
  });

  return Response.json(quotes, { headers: { "Cache-Control": "no-store" } });
}
