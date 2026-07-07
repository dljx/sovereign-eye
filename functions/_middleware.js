// EXACT paths where a Bearer token is accepted — each handler re-validates the token
// against DD_UPLOAD_SECRET itself. Matched exactly (not by prefix) so:
//   - GET /api/dd/live/:ticker (the debate-event reader) is NOT exposed to any Bearer
//   - /api/dd/trigger (which does NOT re-validate a token, see trigger.js) is no longer
//     reachable with an arbitrary Bearer — it now requires the dashboard's Basic auth.
const BEARER_PATHS = ["/api/dd/upload", "/api/dd/live", "/api/dd/history", "/api/dd/positions"];

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
      if (allowed.includes(user) && pass === storedPass) {
        return await context.next();
      }
    }

    // Bearer auth — only forwarded to specific write endpoints that re-validate the token.
    // Prevents any Bearer value from bypassing Basic Auth on other routes (e.g. /api/positions).
    if (scheme === "Bearer") {
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
