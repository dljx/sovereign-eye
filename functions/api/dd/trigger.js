/**
 * POST /api/dd/trigger
 * Body: { ticker: "EME" }
 * Dispatches a GitHub Actions workflow_dispatch event for on-demand analysis.
 */
export async function onRequestPost(context) {
  if (!context.env.GH_REPO || !context.env.GH_TOKEN) {
    return Response.json({ error: "GH_REPO / GH_TOKEN env not configured" }, { status: 500 });
  }

  let ticker;
  try {
    const body = await context.request.json();
    ticker = (body.ticker || "").toUpperCase().trim();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // First char alphanumeric: a leading "-" must never reach a CLI as an argument.
  if (!ticker || !/^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return Response.json({ error: "invalid ticker" }, { status: 400 });
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
      body: JSON.stringify({ ref: "master", inputs: { ticker } }),
    }
  );

  const status = res.status;
  const ok = res.ok || status === 204;
  return Response.json({ ok, ticker, status }, { status: ok ? 200 : 502 });
}
