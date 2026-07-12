// EXACT paths where a Bearer token is accepted — each handler re-validates the token
// against DD_UPLOAD_SECRET itself. Matched exactly (not by prefix) so:
//   - GET /api/dd/live/:ticker (the debate-event reader) is NOT exposed to any Bearer
//   - /api/dd/trigger (which does NOT re-validate a token, see trigger.js) is no longer
//     reachable with an arbitrary Bearer — it now requires the dashboard's Basic auth.
const BEARER_PATHS = [
  "/api/dd/upload", "/api/dd/live", "/api/dd/history", "/api/dd/positions",
  "/api/dd/nav-broker", // broker_sync pushes daily NAV/flows/income (POST, self-validates)
  "/api/dd/thesis",     // portfolio run reads registry + posts adherence checks (self-validates)
  "/api/dd/scouts", "/api/dd/gems", "/api/dd/index", // trigger engine reads boards (GET self-validates)
  "/api/nav-history",  // dd cron stamps the daily NAV snapshot (GET, self-validates)
  "/api/fire",         // quarterly fire_check reads settings (GET-only for bearer, self-validates)
];

// Constant-time string equality via SHA-256 digests — `a === b` short-circuits
// on the first differing byte, a (remote-impractical but free-to-close) timing
// channel on the dashboard password (2026-07-11 audit, P2). Comparing fixed-
// length digests makes time independent of where the strings differ.
async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da), vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function handleRequest(context) {
  const auth = context.request.headers.get("Authorization");

  if (auth) {
    const [scheme, encoded] = auth.split(" ");

    // Basic auth — dashboard users
    if (scheme === "Basic") {
      const storedPass = context.env.DASHBOARD_PASSWORD;
      if (!storedPass) {
        // JSON body — every /api consumer expects res.json() to parse.
        return Response.json({ error: "DASHBOARD_PASSWORD env var not configured" }, { status: 500 });
      }
      let decoded = "";
      try {
        decoded = atob(encoded || "");
      } catch {
        decoded = "";  // malformed base64 — treat as failed auth, not an unhandled 500
      }
      const colonIdx = decoded.indexOf(":");
      const user = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
      const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : "";
      // Allowed usernames from env (comma-separated), default "daryl". Single
      // shared DASHBOARD_PASSWORD. Lets you add a viewer without a code change.
      const allowed = (context.env.DASHBOARD_USERS || "daryl")
        .split(",").map(u => u.trim()).filter(Boolean);
      if (allowed.includes(user) && await timingSafeEqual(pass, storedPass)) {
        return await context.next();
      }
    }

    // Bearer auth — only forwarded to specific endpoints that re-validate the
    // token, and only when a NON-EMPTY credential follows the scheme. A bare
    // "Authorization: Bearer" used to be forwarded, and handlers that treat
    // parsed-bearer-absence as "already Basic-authed" then let an
    // unauthenticated request through (found live 2026-07-08).
    if (scheme === "Bearer" && encoded) {
      const pathname = new URL(context.request.url).pathname;
      if (BEARER_PATHS.includes(pathname)) {
        return await context.next();
      }
    }
  }

  // JSON body (frontend res.json() must parse); WWW-Authenticate still triggers
  // the browser's Basic-auth prompt regardless of body shape.
  return new Response(JSON.stringify({ error: "Authentication required" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Basic realm="Sovereign Eye", charset="UTF-8"',
    },
  });
}

export const onRequest = [handleRequest];
