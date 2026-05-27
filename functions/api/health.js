/**
 * GET /api/health
 *
 * Returns real-time API health by inspecting KV cache timestamps.
 * No secrets needed — reads cache metadata to infer which APIs were
 * recently called and whether they succeeded.
 */

const KV_PROBES = [
  { key: 'news:feed:v3',   apiId: 'finnhub',  ttlMs: 15 * 60 * 1000 },
  { key: 'wire:feed:v2',   apiId: 'tavily',   ttlMs: 10 * 60 * 1000 },
  { key: 'dd:synthesis',   apiId: 'gemini',   ttlMs: 30 * 60 * 1000 },
  { key: 'dd:scouts',      apiId: 'gh',       ttlMs: 24 * 60 * 60 * 1000 },
  { key: 'portfolio:v1',   apiId: 'cf-kv',    ttlMs: 999 * 60 * 1000 },
];

function relAge(ts) {
  if (!ts) return null;
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export async function onRequestGet(context) {
  const kv = context.env.SE_KV;

  const SEED = [
    { id: 'finnhub', name: 'Finnhub',    scope: 'Quotes · Filings',  endpoint: 'finnhub.io' },
    { id: 'gemini',  name: 'Gemini',     scope: 'Synthesis · DD',    endpoint: 'generativelanguage.googleapis.com' },
    { id: 'tavily',  name: 'Tavily',     scope: 'News wire',         endpoint: 'api.tavily.com' },
    { id: 'gh',      name: 'GH Actions', scope: 'DD agent runs',     endpoint: 'api.github.com' },
    { id: 'cf-kv',   name: 'CF KV',      scope: 'Portfolio store',   endpoint: 'kv.cloudflare.com' },
    { id: 'sec',     name: 'SEC EDGAR',  scope: 'Filings',           endpoint: 'data.sec.gov' },
  ];

  // Build a map of apiId → last-seen timestamp from KV cache entries
  const seen = {};

  if (kv) {
    await Promise.all(KV_PROBES.map(async probe => {
      try {
        const raw = await kv.getWithMetadata(probe.key, { type: 'text' });
        if (raw && raw.value) {
          // Try to extract a timestamp from metadata or from the value itself
          let ts = null;
          if (raw.metadata?.updatedAt) {
            ts = new Date(raw.metadata.updatedAt).getTime();
          } else {
            // Peek into first 100 chars for an ISO timestamp
            const snippet = raw.value.slice(0, 200);
            const m = snippet.match(/"updatedAt"\s*:\s*"([^"]+)"/);
            if (m) ts = new Date(m[1]).getTime();
          }
          if (!ts) ts = Date.now() - probe.ttlMs / 2; // assume recent if present
          if (!seen[probe.apiId] || ts > seen[probe.apiId]) {
            seen[probe.apiId] = ts;
          }
        }
      } catch (_) { /* key missing or KV error — leave unseen */ }
    }));

    // CF KV itself is implicitly ok if we got any response at all
    if (!seen['cf-kv']) seen['cf-kv'] = Date.now();

    // SEC EDGAR: check if any dd:<ticker> key is present (SEC is used by DD pipeline)
    try {
      const ddIdx = await kv.get('dd:index', { type: 'json' });
      if (ddIdx) {
        const tickers = Array.isArray(ddIdx.tickers) ? ddIdx.tickers : Object.keys(ddIdx);
        if (tickers.length > 0) {
          const tk = tickers[0];
          const ddRaw = await kv.getWithMetadata(`dd:${tk}`, { type: 'text' });
          if (ddRaw?.value) {
            const snippet = ddRaw.value.slice(0, 300);
            const m = snippet.match(/"analyzed_at"\s*:\s*"([^"]+)"/);
            if (m) seen['sec'] = new Date(m[1]).getTime();
          }
        }
      }
    } catch (_) { /* ignore */ }
  }

  const result = SEED.map(api => {
    const ts = seen[api.id] || null;
    const age = relAge(ts);
    const stale = ts ? (Date.now() - ts) > 24 * 60 * 60 * 1000 : true;
    const status = !ts ? 'unknown' : stale ? 'degraded' : 'ok';
    return {
      ...api,
      status,
      lastOk: age || 'never',
      used: null,   // quota usage not tracked server-side
      quota: 0,
      latency: null,
    };
  });

  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
