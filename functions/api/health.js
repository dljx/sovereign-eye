/**
 * GET /api/health
 *
 * Real-time API health. Pings Finnhub live; for the others, infers "recently ok"
 * from the presence of a recently-written KV key.
 *
 * IMPORTANT: these are matched by PREFIX (via KV list), not exact key, because the
 * cache keys are version-suffixed (e.g. wire:feed:v7, news:tk:v15:*) and bumping a
 * version must NOT silently break the health check — which is exactly what made
 * Tavily show "down" (health looked for wire:feed:v2 while wire.js wrote v7).
 */

import { geminiKeys } from "./_gemini.js";

const KV_CHECKS = [
  { prefix: 'news:portfolio:', apiId: 'finnhub' },  // news.js scored cache (news.js writes news:portfolio:v1:*)
  { prefix: 'dd:synthesis', apiId: 'gemini' },
  { prefix: 'wire:feed:', apiId: 'tavily'  },  // wire.js Tavily news wire
  // NB: 'gh' (the DD screen) is handled by ddScreenHealth() below, NOT here —
  // presence of dd:scouts/dd:index can't distinguish a live cron from a dead one
  // (those keys never expire). Freshness needs the dd:meta heartbeat.
];

// The daily DD cron runs Mon–Fri ~06:00 ET. A successful upload is at most ~24h
// old on a weekday; over a weekend the last run is Friday, so the heartbeat can
// legitimately read 1–3 days old. 26h flags a weekday cron that silently died by
// the next morning; weekend staleness is real ("this is Friday's data"), not a
// false alarm — the age string makes that self-evident.
const DD_STALE_MS = 26 * 60 * 60 * 1000;

// True if at least one KV key with this prefix exists (service wrote recently).
async function kvHasPrefix(kv, prefix) {
  if (!kv) return false;
  try {
    const { keys } = await kv.list({ prefix, limit: 1 });
    return Array.isArray(keys) && keys.length > 0;
  } catch {
    return false;
  }
}

// Human-readable age, e.g. "12m ago", "5h ago", "2d ago".
function relAge(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// DD-screen freshness via the dd:meta upload heartbeat (written by upload.js on
// every cron upload). Falls back to dd:scouts/dd:index presence when no heartbeat
// exists yet (pre-heartbeat state) so this never regresses below the old check.
async function ddScreenHealth(kv) {
  if (!kv) return { status: 'degraded', lastOk: 'no KV' };
  try {
    const meta = await kv.get('dd:meta', 'json');
    if (meta && meta.lastUploadAt) {
      const ageMs = Date.now() - new Date(meta.lastUploadAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0) {
        return {
          status: ageMs < DD_STALE_MS ? 'ok' : 'degraded',
          lastOk: relAge(ageMs),
        };
      }
    }
  } catch { /* fall through to presence check */ }
  // No usable heartbeat yet — degrade gracefully to the legacy presence signal.
  const present = (await kvHasPrefix(kv, 'dd:scouts')) || (await kvHasPrefix(kv, 'dd:index'));
  return present
    ? { status: 'ok', lastOk: 'recently' }
    : { status: 'no-data', lastOk: 'no data yet' };
}

async function pingFinnhub(apiKey) {
  if (!apiKey) return { ok: false, latency: null };
  const t0 = Date.now();
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    return { ok: r.ok, latency: Date.now() - t0 };
  } catch {
    return { ok: false, latency: null };
  }
}

// Live Supabase ping — a paused/broken project was invisible for weeks because
// every caller fails silent by design. One cheap HEAD-equivalent REST read.
async function pingSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return { ok: false, latency: null, configured: false };
  const t0 = Date.now();
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/dd_history?select=id&limit=1`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY },
      signal: AbortSignal.timeout(4000),
    });
    return { ok: r.ok, latency: Date.now() - t0, configured: true };
  } catch {
    return { ok: false, latency: null, configured: true };
  }
}

export async function onRequestGet(context) {
  // 4-min edge cache: the dashboard polls health every 5 min per client, and
  // an uncached call costs ~3 kv.list ops (a day-long open tab approached the
  // 1,000/day free-tier LIST ceiling) plus two live upstream pings.
  const cacheKey = new Request(new URL(context.request.url).toString());
  const cache = caches.default;
  const edgeCached = await cache.match(cacheKey);
  if (edgeCached) return edgeCached;

  const kv      = context.env.DD_KV;
  const fhKey   = (context.env.FINNHUB_API_KEY || '').trim();
  const gemKeyCount = geminiKeys(context.env).length;

  // Run all checks in parallel
  const [fhPing, ddHealth, sbPing, ...kvResults] = await Promise.all([
    pingFinnhub(fhKey),
    ddScreenHealth(kv),
    pingSupabase(context.env),
    ...KV_CHECKS.map(({ prefix }) => kvHasPrefix(kv, prefix)),
  ]);

  const kvMap = {};
  KV_CHECKS.forEach(({ apiId }, i) => { kvMap[apiId] = kvResults[i]; });

  // Finnhub: ok if ping succeeded; fallback to kv presence
  const fhOk = fhPing.ok || kvMap['finnhub'];

  const result = [
    {
      id: 'finnhub', name: 'Finnhub', scope: 'Quotes · Filings', endpoint: 'finnhub.io',
      status:  fhOk ? 'ok' : 'degraded',
      latency: fhPing.latency,
      lastOk:  fhPing.ok ? 'just now' : (kvMap['finnhub'] ? 'recently' : 'no data yet'),
    },
    {
      id: 'gemini', name: 'Gemini', scope: `Synthesis · DD · ${gemKeyCount} key${gemKeyCount === 1 ? '' : 's'}`, endpoint: 'generativelanguage.googleapis.com',
      status:  gemKeyCount > 0 ? 'ok' : 'degraded',
      latency: null,
      keys:    gemKeyCount,
      lastOk:  kvMap['gemini'] ? 'recently' : 'no data yet',
    },
    {
      id: 'tavily', name: 'Tavily', scope: 'News wire', endpoint: 'api.tavily.com',
      status:  kvMap['tavily'] ? 'ok' : 'no-data',
      latency: null,
      lastOk:  kvMap['tavily'] ? 'recently' : 'no data yet',
    },
    {
      id: 'gh', name: 'GH Actions', scope: 'DD agent runs', endpoint: 'api.github.com',
      status:  ddHealth.status,
      latency: null,
      lastOk:  ddHealth.lastOk,
    },
    {
      id: 'cf-kv', name: 'CF KV', scope: 'Portfolio store', endpoint: 'kv.cloudflare.com',
      status:  kv ? 'ok' : 'degraded',
      latency: null,
      lastOk:  kv ? 'just now' : 'never',
    },
    {
      id: 'supabase', name: 'Supabase', scope: 'History archives', endpoint: 'supabase.co',
      status:  sbPing.ok ? 'ok' : (sbPing.configured ? 'degraded' : 'no-data'),
      latency: sbPing.latency,
      lastOk:  sbPing.ok ? 'just now' : (sbPing.configured ? 'unreachable' : 'not configured'),
    },
    {
      id: 'sec', name: 'SEC EDGAR', scope: 'Filings', endpoint: 'data.sec.gov',
      status:  'ok',
      latency: null,
      lastOk:  'on demand',
    },
  ].map(api => ({ ...api, used: null, quota: 0 }));

  const response = Response.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=240' },
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
