/**
 * GET /api/news-archive?ticker=AMZN&days=7&limit=50
 *
 * Returns archived news items from Supabase news_archive table.
 * Ordered by importance desc, then published_at desc.
 */
export async function onRequestGet(context) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return Response.json([], { headers: { 'X-Supabase': 'not-configured' } });
  }

  const url    = new URL(context.request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const days   = Math.min(parseInt(url.searchParams.get('days') || '7', 10), 30);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const params = {
    order:          'importance.desc,published_at.desc',
    limit:          String(limit),
    published_at:   `gte.${cutoff}`,
    select:         'ticker,tag,source,headline,why,importance,severity,url,published_at',
  };
  if (ticker && /^[A-Z]{1,10}$/.test(ticker)) {
    params.ticker = `eq.${ticker}`;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/news_archive?${new URLSearchParams(params)}`, {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return Response.json([], { status: res.status });
    const rows = await res.json();
    return Response.json(Array.isArray(rows) ? rows : []);
  } catch {
    return Response.json([]);
  }
}
