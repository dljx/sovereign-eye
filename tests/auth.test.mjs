// Auth middleware regression tests. Locks the /api/dd/trigger bypass fix.
// Run: node tests/auth.test.mjs   (no build step / package.json needed)
//
// functions/_middleware.js is ESM but the repo has no package.json "type":"module",
// so we copy it to a temp .mjs and import that.

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "se-auth-"));
const copy = join(tmp, "_middleware.mjs");
writeFileSync(copy, readFileSync(join(__dirname, "..", "functions", "_middleware.js")));
const { onRequest } = await import(pathToFileURL(copy).href);
const handler = onRequest[0];

const ENV = { DASHBOARD_PASSWORD: "secret" };
const b64 = s => Buffer.from(s).toString("base64");
const ctx = (auth, path, env = ENV) => ({
  request: { headers: { get: k => (k === "Authorization" ? auth : null) }, url: `https://x${path}` },
  env,
  next: async () => new Response("NEXT", { status: 200 }),
});

let failed = 0;
async function check(name, auth, path, expected, env = ENV) {
  const r = await handler(ctx(auth, path, env));
  const ok = r.status === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} -> ${r.status} (want ${expected})`);
}

const basic = "Basic " + b64("daryl:secret");

// The fix: an arbitrary Bearer must NOT reach /api/dd/trigger or the live reader.
await check("Bearer -> /api/dd/trigger blocked", "Bearer x", "/api/dd/trigger", 401);
await check("Bearer -> /api/dd/live/GOOG reader blocked", "Bearer x", "/api/dd/live/GOOG", 401);
// Legit bearer write endpoints still pass middleware (they re-validate internally).
await check("Bearer -> /api/dd/upload allowed", "Bearer x", "/api/dd/upload", 200);
await check("Bearer -> /api/dd/live (POST) allowed", "Bearer x", "/api/dd/live", 200);
await check("Bearer -> /api/dd/history allowed", "Bearer x", "/api/dd/history", 200);
await check("Bearer -> /api/dd/positions allowed", "Bearer x", "/api/dd/positions", 200);
// /api/positions (Basic-only) must NOT be reachable with a Bearer.
await check("Bearer -> /api/positions blocked", "Bearer x", "/api/positions", 401);
// FIRE-feature bearer paths (both self-validate DD_UPLOAD_SECRET internally).
await check("Bearer -> /api/nav-history forwarded", "Bearer x", "/api/nav-history", 200);
await check("Bearer -> /api/fire forwarded", "Bearer x", "/api/fire", 200);
// A BARE "Bearer" (no token) must NOT be forwarded — handlers that treat
// parsed-bearer-absence as Basic-authed would let it straight through
// (live finding, 2026-07-08).
await check("bare Bearer -> /api/fire blocked", "Bearer", "/api/fire", 401);
await check("bare Bearer -> /api/dd/upload blocked", "Bearer", "/api/dd/upload", 401);
await check("empty Bearer -> /api/fire blocked", "Bearer ", "/api/fire", 401);
// Dashboard Basic auth.
await check("Basic daryl -> /api/dd/trigger ok", basic, "/api/dd/trigger", 200);
await check("Basic wrong pass -> 401", "Basic " + b64("daryl:nope"), "/api/positions", 401);
await check("no auth -> 401", null, "/api/positions", 401);
await check("malformed base64 -> 401 (not 500)", "Basic !!!notb64", "/api/positions", 401);
// DASHBOARD_USERS: default allows only daryl; extra user works when configured.
const MULTI = { DASHBOARD_PASSWORD: "secret", DASHBOARD_USERS: "daryl,wife" };
await check("unknown user bob -> 401 (default)", "Basic " + b64("bob:secret"), "/api/positions", 401);
await check("wife with DASHBOARD_USERS -> 200", "Basic " + b64("wife:secret"), "/api/positions", 200, MULTI);
await check("wife wrong pass -> 401", "Basic " + b64("wife:nope"), "/api/positions", 401, MULTI);

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL AUTH TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
