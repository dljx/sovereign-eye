const CREDENTIALS = { username: "daryl", password: "sovereign2026" };

async function handleRequest(context) {
  const auth = context.request.headers.get("Authorization");

  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic") {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(":");
      if (user === CREDENTIALS.username && pass === CREDENTIALS.password) {
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
