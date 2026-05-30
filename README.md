# Sovereign Eye

Personal portfolio + due-diligence dashboard. Cloudflare Pages (Functions for the
API, React for the UI, built with esbuild). Reads data produced by **sovereign-dd**.

See **ARCHITECTURE.md** for how the two repos fit together and **DATA_CONTRACT.md**
for the JSON/KV contract.

## Layout

- `functions/api/*.js` — Cloudflare Pages Functions (HTTP API). Auth in `functions/_middleware.js` (HTTP Basic for the dashboard; Bearer `DD_UPLOAD_SECRET` for dd uploads).
- `index.html` (desktop) / `mobile.html` (mobile) — entry points. `build.mjs` (esbuild) transforms+minifies the `.jsx` into content-hashed `.js` under `dist/` and rewrites the HTML to point at them (no in-browser Babel, no manual cache-busting).
- `*.jsx` — `app.jsx`, `desktop-panels.jsx`, `mobile.jsx`, `components.jsx`, `data.jsx`, `dd-shared.jsx`, `debate-room.jsx`, `import-modal.jsx`, `tweaks-panel.jsx`; `positions.js`/`seed.js` are config/seed.
- `android/` — Capacitor wrapper; `.github/workflows/build-apk.yml` builds the APK.

## Local dev

The source uses bare JSX, so `wrangler pages dev .` won't transform it — build first and serve `dist/`:

```bash
cp .dev.vars.example .dev.vars   # fill in secrets (gitignored)
node build.mjs                   # -> dist/
npx wrangler pages dev dist
```

## Deploy (production)

```bash
./deploy.sh      # builds (esbuild -> dist/) then wrangler pages deploy dist --branch=<prod>
```

Always deploy via `./deploy.sh` (or `node build.mjs && wrangler pages deploy dist --branch=main`).
Deploying the source dir directly would ship the un-built app. Pages is **not** git-connected.
KV namespace `DD_KV` and all secrets are configured in the Cloudflare Pages dashboard. Set up KV once:

```bash
wrangler kv namespace create "sovereign-dd-results"   # paste id into wrangler.toml + dashboard
```

## Secrets

Configured as Cloudflare Pages environment variables (see `.dev.vars.example` for the list):
`DASHBOARD_PASSWORD`, `DD_UPLOAD_SECRET`, `GEMINI_API_KEYS`, `FINNHUB_API_KEY`,
`TAVILY_API_KEY` (+ optional `TAVILY_API_KEYS` fallbacks), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GH_REPO`, `GH_TOKEN`.
