/**
 * GET /api/dd/trend?ticker=AMZN&limit=30
 *
 * Returns historical DD runs for a ticker from Supabase dd_history table.
 * Used to render fair-value trend sparklines in DDPanel.
 */
export async function onRequestGet(context) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return Response.json([], { headers: { 'X-Supabase': 'not-configured' } });
  }

  const url    = new URL(context.request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 90);

  if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
    return Response.json({ error: 'ticker required' }, { status: 400 });
  }

  const qs = new URLSearchParams({
    ticker:  `eq.${ticker}`,
    order:   'run_at.desc',
    limit:   String(limit),
    select:  'run_at,price,composite_fv,result_fv,mos,score,grade,is_banger',
  });

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/dd_history?${qs}`, {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return Response.json([], { status: res.status });
    const rows = await res.json();
    return Response.json(Array.isArray(rows) ? rows : [], {
      headers: { 'Cache-Control': 'public, s-maxage=300' },
    });
  } catch {
    // Honest failure — callers guard with r.ok and keep whatever they had.
    return Response.json({ error: "Supabase unavailable" }, { status: 503 });
  }
}
