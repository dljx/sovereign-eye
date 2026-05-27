/**
 * GET /api/health
 *
 * Lightweight API health check. For each service:
 * - CF KV: always ok (endpoint itself proves KV is up)
 * - Finnhub: real ping against /api/v1/quote?symbol=AAPL
 * - Others: check KV cache-key existence + rough age
 *
 * Unknown = no cached data yet → ok (not degraded)
 * Degraded = key exists but >2h stale, or ping failed
 */

const CACHE_KEYS = {
  finnhub: 'news:feed:v3',
  gemini:  'dd:synthesis',
  tavily:  'wire:feed:v2',
  gh:      'dd:scouts',
};

const STALE_MS = 2 * 60 * 60 * 1000; // 2h

function relAge(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

async function checkKvKey(kv, key) {
  try {
    const raw = await kv.getWithMetadata(key, { type: 'text' });
    if (!raw?.value) return { present: false };

    // Try metadata.updatedAt first
    let ts = raw.metadata?.updatedAt ? new Date(raw.metadata.updatedAt).getTime() : null;

    // Fall back to scanning first 300 chars of value for ISO timestamp fields
    if (!ts) {
      const snippet = (raw.value || '').slice(0, 300);
      const m = snippet.match(/"(?:updatedAt|cachedAt|generated_at|timestamp)"\s*:\s*"([^"]+)"/);
      if (m) ts = new Date(m[1]).getTime();
    }

    return { present: true, ts };
  } catch {
    return { present: false };
  }
}

export async function onRequestGet(context) {
  const kv     = context.env.SE_KV;
  const finnKey = (context.env.FINNHUB_API_KEY || '').trim();

  // Run all checks in parallel
  const [finnhubPing, kvFinnnhub, kvGemini, kvTavily, kvGh] = await Promise.all([
    pingFinnhub(finnKey),
    kv ? checkKvKey(kv, CACHE_KEYS.finnhub) : Promise.resolve({ present: false }),
    kv ? checkKvKey(kv, CACHE_KEYS.gemini)  : Promise.resolve({ present: false }),
    kv ? checkKvKey(kv, CACHE_KEYS.tavily)  : Promise.resolve({ present: false }),
    kv ? checkKvKey(kv, CACHE_KEYS.gh)      : Promise.resolve({ present: false }),
  ]);

  const now = Date.now();

  function kvStatus(info) {
    if (!info.present) return { status: 'ok', lastOk: 'no data yet' };
    if (info.ts) {
      const age = now - info.ts;
      return {
        status: age > STALE_MS ? 'degraded' : 'ok',
        lastOk: relAge(age),
      };
    }
    return { status: 'ok', lastOk: 'cached' };
  }

  const fhKv = kvStatus(kvFinnnhub);
  const gemKv = kvStatus(kvGemini);
  const tvKv  = kvStatus(kvTavily);
  const ghKv  = kvStatus(kvGh);

  const result = [
    {
      id: 'finnhub', name: 'Finnhub', scope: 'Quotes · Filings', endpoint: 'finnhub.io',
      status:  finnhubPing.ok ? 'ok' : (fhKv.status === 'ok' ? 'ok' : 'degraded'),
      latency: finnhubPing.latency,
      lastOk:  finnhubPing.ok ? 'just now' : fhKv.lastOk,
      used: null, quota: 0,
    },
    {
      id: 'gemini', name: 'Gemini', scope: 'Synthesis · DD', endpoint: 'generativelanguage.googleapis.com',
      ...gemKv, latency: null, used: null, quota: 0,
    },
    {
      id: 'tavily', name: 'Tavily', scope: 'News wire', endpoint: 'api.tavily.com',
      ...tvKv, latency: null, used: null, quota: 0,
    },
    {
      id: 'gh', name: 'GH Actions', scope: 'DD agent runs', endpoint: 'api.github.com',
      ...ghKv, latency: null, used: null, quota: 0,
    },
    {
      id: 'cf-kv', name: 'CF KV', scope: 'Portfolio store', endpoint: 'kv.cloudflare.com',
      status: kv ? 'ok' : 'degraded',
      latency: null, lastOk: kv ? 'just now' : 'never', used: null, quota: 0,
    },
    {
      id: 'sec', name: 'SEC EDGAR', scope: 'Filings', endpoint: 'data.sec.gov',
      status: 'ok', latency: null, lastOk: 'on demand', used: null, quota: 0,
    },
  ];

  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
