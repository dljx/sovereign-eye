/**
 * Shared Gemini client with multi-key rotation + 429 failover.
 *
 * Keys are read from env.GEMINI_API_KEYS (comma-separated) and fall back to the
 * single env.GEMINI_API_KEY. Each call starts at a random key (to spread load
 * across the pool) and, on a 429 or 5xx, fails over to the next key in the pool.
 *
 * Underscore-prefixed: NOT a route — imported by sibling endpoints.
 */

export function geminiKeys(env) {
  const multi = (env.GEMINI_API_KEYS || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
  if (multi.length) return multi;
  const single = (env.GEMINI_API_KEY || "").trim();
  return single ? [single] : [];
}

/**
 * POST to a Gemini model, rotating across keys on rate-limit/server errors.
 * Returns the fetch Response (the successful one, or the last failing one), so
 * callers keep their existing `res.ok` / `res.json()` handling.
 *
 * @param {object} env      Worker env
 * @param {string} modelPath e.g. "gemini-3.5-flash:generateContent"
 * @param {object} body     request JSON body
 */
export async function geminiFetch(env, modelPath, body, opts = {}) {
  const keys = geminiKeys(env);
  if (!keys.length) throw new Error("No Gemini API key configured");

  // Default to a 20s per-request timeout so a hung fetch can't run out the Worker's
  // wall-clock budget with no error. Callers may override via opts.timeoutMs.
  const timeoutMs = opts.timeoutMs || 20000;
  const start = Math.floor(Math.random() * keys.length);
  const payload = JSON.stringify(body);
  let lastRes = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        }
      );
    } catch {
      continue; // network error / timeout — try the next key
    }
    if (res.ok) return res;
    lastRes = res;
    // Only rotate on rate-limit / transient server errors; other errors won't
    // be fixed by a different key, so return immediately.
    if (res.status !== 429 && res.status < 500) return res;
    // Rotating past this response — cancel its unread body, or the runtime's
    // in-flight cap may cancel a healthy fetch in this invocation instead.
    try { if (res.body) res.body.cancel().catch(() => {}); } catch {}
  }
  // Every key failed. If they all threw (network/timeout) lastRes is null — return a
  // synthetic 502 so callers can always rely on a Response (res.ok / res.status).
  return lastRes || new Response(
    JSON.stringify({ error: "All Gemini keys failed (network/timeout)" }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
