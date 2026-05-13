/**
 * POST /api/dd/trigger
 * Body: { ticker: "EME" }
 * Dispatches a GitHub Actions workflow_dispatch event for on-demand analysis.
 */
export async function onRequestPost(context) {
  let ticker;
  try {
    const body = await context.request.json();
    ticker = (body.ticker || "").toUpperCase().trim();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
    return new Response(JSON.stringify({ error: "invalid ticker" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = await fetch(
    `https://api.github.com/repos/${context.env.GH_REPO}/actions/workflows/analyze.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.GH_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "sovereign-eye",
      },
      body: JSON.stringify({ ref: "main", inputs: { ticker } }),
    }
  );

  const status = res.status;
  const ok = res.ok || status === 204;
  return new Response(JSON.stringify({ ok, ticker, status }), {
    status: ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}
