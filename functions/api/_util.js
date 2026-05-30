/**
 * Shared helpers for the API endpoints. Underscore-prefixed: NOT a route.
 */

// Canonical ticker regex — allows exchange suffixes + digits (AAPL, BRK.B, HPQ.V).
export const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

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
 * Best-effort parse of an LLM "JSON array" reply: strip code fences, then if the
 * array is truncated, close it at the last complete object.
 */
export function salvageArray(str) {
  const s = (str || "").replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try { return JSON.parse(s); } catch {}
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace > 0) {
    try { return JSON.parse(s.slice(0, lastBrace + 1) + "]"); } catch {}
  }
  return null;
}

/**
 * POST already-shaped rows to the Supabase news_archive table. Callers build the
 * rows (the shapes differ per endpoint); this owns the shared, no-throw POST.
 */
export async function postNewsArchive(env, rows) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  const valid = (rows || []).filter(r => r && r.headline);
  if (!valid.length) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/news_archive`, {
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
