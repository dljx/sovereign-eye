/**
 * Shared helpers for the API endpoints. Underscore-prefixed: NOT a route.
 */

export function heuristicScore(headline) {
  const h = headline.toLowerCase();
  if (/earnings|beat|miss|revenue|guidance|raised guidance|lowered guidance|eps/.test(h)) return 84;
  if (/analyst|upgrade|downgrade|price target|overweight|underweight|outperform/.test(h)) return 74;
  if (/merger|acquisition|buyout|takeover|ipo|buyback|dividend/.test(h)) return 70;
  if (/ceo|cfo|chief executive|exec.*resign|exec.*appoint/.test(h)) return 66;
  if (/federal reserve|interest rate|inflation|cpi|gdp|jobs report|nonfarm/.test(h)) return 62;
  if (/regulation|lawsuit|investigation|fine|penalty|probe|sec\b/.test(h)) return 60;
  if (/product launch|partnership|contract|deal worth/.test(h)) return 52;
  return 36;
}

export function heuristicSentiment(headline) {
  const h = headline.toLowerCase();
  if (/beats?|exceeds?|surges?|soars?|jumps?|raises? (guidance|outlook|forecast)|upgraded|record (high|revenue|profit)|strong (earnings|results)|growth/.test(h)) return 'bull';
  if (/misses?|falls?|drops?|cuts? (guidance|forecast|jobs)|downgrades?|loss|decline|concern|weak|slump|layoff|below (estimates?|expectations?)/.test(h)) return 'bear';
  return 'neutral';
}

// Canonical ticker regex — allows exchange suffixes + digits (AAPL, BRK.B, HPQ.V).
export const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

/**
 * Word-boundary truncation for user-facing prose (headlines, "why" strings).
 * Mirrors sovereign-dd's text_utils.clip: never ends mid-word, ellipsis only
 * when text was actually cut. Raw .slice(0, N) is for keys/dates/arrays only.
 */
export function clipWord(s, n) {
  s = s || "";
  if (s.length <= n) return s;
  let cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  if (sp > n * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/\s+$/, "") + "…";
}

/**
 * Relative "Nm/Nh/Nd" string. Accepts either a unix-seconds number (Finnhub
 * datetime) OR a date string (Tavily published_date). Unifies the two prior
 * per-endpoint copies which differed only in input type.
 */
export function timeAgo(input) {
  const ms = typeof input === "number" ? input * 1000 : new Date(input).getTime();
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/**
 * Best-effort parse of an LLM "JSON array" reply.
 * Handles: clean JSON, markdown fences, preamble/postamble text, truncated arrays.
 */
export function salvageArray(str) {
  const s = (str || "").trim();
  // 1. Direct parse (clean JSON)
  try { return JSON.parse(s); } catch {}
  // 2. Greedy bracket extraction — works even if the model adds surrounding text
  const m = s.match(/\[[\s\S]*\]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
    // 3. Truncated array — close at last complete object
    const lb = m[0].lastIndexOf("}");
    if (lb > 0) {
      try { return JSON.parse(m[0].slice(0, lb + 1) + "]"); } catch {}
    }
  }
  return null;
}

/**
 * POST already-shaped rows to the Supabase news_archive table. Callers build the
 * rows (the shapes differ per endpoint); this owns the shared, no-throw POST.
 */
export async function postNewsArchive(env, rows) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  // ticker '' (not null) for MACRO rows — NULLs are distinct in Postgres, so the
  // (ticker, headline) unique constraint only dedupes when ticker is non-null.
  const valid = (rows || [])
    .filter(r => r && r.headline)
    .map(r => ({ ...r, ticker: r.ticker ?? "" }));
  if (!valid.length) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/news_archive?on_conflict=ticker,headline`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify(valid),
    });
  } catch {}
}
