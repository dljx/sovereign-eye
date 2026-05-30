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
  { prefix: 'news:tk:',  apiId: 'finnhub' },  // news.js per-ticker scored cache
  { prefix: 'dd:synthesis', apiId: 'gemini' },
  { prefix: 'wire:feed:', apiId: 'tavily'  },  // wire.js Tavily news wire
  { prefix: 'dd:scouts',  apiId: 'gh'      },
];

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

export async function onRequestGet(context) {
  const kv      = context.env.DD_KV;
  const fhKey   = (context.env.FINNHUB_API_KEY || '').trim();
  const gemKeyCount = geminiKeys(context.env).length;

  // Run all checks in parallel
  const [fhPing, ...kvResults] = await Promise.all([
    pingFinnhub(fhKey),
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
      status:  kvMap['gh'] ? 'ok' : 'no-data',
      latency: null,
      lastOk:  kvMap['gh'] ? 'recently' : 'no data yet',
    },
    {
      id: 'cf-kv', name: 'CF KV', scope: 'Portfolio store', endpoint: 'kv.cloudflare.com',
      status:  kv ? 'ok' : 'degraded',
      latency: null,
      lastOk:  kv ? 'just now' : 'never',
    },
    {
      id: 'sec', name: 'SEC EDGAR', scope: 'Filings', endpoint: 'data.sec.gov',
      status:  'ok',
      latency: null,
      lastOk:  'on demand',
    },
  ].map(api => ({ ...api, used: null, quota: 0 }));

  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
