// Paths where Bearer tokens are accepted — each handler re-validates the token itself.
// All other paths require Basic Auth from the dashboard user.
const BEARER_PATHS = ["/api/dd/upload", "/api/dd/live", "/api/dd/trigger"];

async function handleRequest(context) {
  const auth = context.request.headers.get("Authorization");

  if (auth) {
    const [scheme, encoded] = auth.split(" ");

    // Basic auth — dashboard users
    if (scheme === "Basic") {
      const storedPass = context.env.DASHBOARD_PASSWORD;
      if (!storedPass) {
        return new Response("DASHBOARD_PASSWORD env var not configured", { status: 500 });
      }
      const decoded = atob(encoded || "");
      const colonIdx = decoded.indexOf(":");
      const user = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
      const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : "";
      if (user === "daryl" && pass === storedPass) {
        return await context.next();
      }
    }

    // Bearer auth — only forwarded to specific write endpoints that re-validate the token.
    // Prevents any Bearer value from bypassing Basic Auth on other routes (e.g. /api/positions).
    if (scheme === "Bearer") {
      const pathname = new URL(context.request.url).pathname;
      if (BEARER_PATHS.some(p => pathname.startsWith(p))) {
        return await context.next();
      }
    }
  }

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Sovereign Eye", charset="UTF-8"',
    },
  });
}

export const onRequest = [handleRequest];
