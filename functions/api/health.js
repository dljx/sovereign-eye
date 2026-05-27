/**
 * GET /api/health
 *
 * Real-time API health. Pings Finnhub live; checks KV key existence for
 * others (key present = successfully written within TTL = ok).
 * Defaults to ok/no-data rather than degraded when a service hasn't been
 * exercised yet.
 */

const KV_CHECKS = [
  { key: 'news:feed:v3',  apiId: 'finnhub' },
  { key: 'dd:synthesis',  apiId: 'gemini'  },
  { key: 'wire:feed:v2',  apiId: 'tavily'  },
  { key: 'dd:scouts',     apiId: 'gh'      },
];

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

  // Run all checks in parallel
  const [fhPing, ...kvResults] = await Promise.all([
    pingFinnhub(fhKey),
    ...KV_CHECKS.map(({ key }) =>
      kv
        ? kv.get(key, 'text').then(v => v !== null).catch(() => false)
        : Promise.resolve(false)
    ),
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
      id: 'gemini', name: 'Gemini', scope: 'Synthesis · DD', endpoint: 'generativelanguage.googleapis.com',
      status:  'ok',
      latency: null,
      lastOk:  kvMap['gemini'] ? 'recently' : 'no data yet',
    },
    {
      id: 'tavily', name: 'Tavily', scope: 'News wire', endpoint: 'api.tavily.com',
      status:  'ok',
      latency: null,
      lastOk:  kvMap['tavily'] ? 'recently' : 'no data yet',
    },
    {
      id: 'gh', name: 'GH Actions', scope: 'DD agent runs', endpoint: 'api.github.com',
      status:  'ok',
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
