# Sovereign Eye

Personal portfolio + due-diligence dashboard. Cloudflare Pages (Functions for the
API, React-via-Babel-in-browser for the UI). Reads data produced by **sovereign-dd**.

See **ARCHITECTURE.md** for how the two repos fit together and **DATA_CONTRACT.md**
for the JSON/KV contract.

## Layout

- `functions/api/*.js` — Cloudflare Pages Functions (HTTP API). Auth in `functions/_middleware.js` (HTTP Basic for the dashboard; Bearer `DD_UPLOAD_SECRET` for dd uploads).
- `index.html` (desktop) / `mobile.html` (mobile) — load `.jsx` directly via `@babel/standalone` with `?v=` cache-bust tags. No build step.
- `*.jsx` — `app.jsx`, `desktop-panels.jsx`, `mobile.jsx`, `components.jsx`, `data.jsx`, `debate-room.jsx`, `import-modal.jsx`, `tweaks-panel.jsx`; `positions.js`/`seed.js` are config/seed.
- `android/` — Capacitor wrapper; `.github/workflows/build-apk.yml` builds the APK.

## Local dev

```bash
cp .dev.vars.example .dev.vars   # fill in secrets (gitignored)
npx wrangler pages dev .
```

## Deploy (production)

```bash
./deploy.sh      # auto-bumps ?v= cache tags, then wrangler pages deploy --branch=<prod>
```

Pages is **not** git-connected — `deploy.sh` deploys the working tree. KV namespace
`DD_KV` and all secrets are configured in the Cloudflare Pages dashboard. Set up KV once:

```bash
wrangler kv namespace create "sovereign-dd-results"   # paste id into wrangler.toml + dashboard
```

## Secrets

Configured as Cloudflare Pages environment variables (see `.dev.vars.example` for the list):
`DASHBOARD_PASSWORD`, `DD_UPLOAD_SECRET`, `GEMINI_API_KEYS`, `FINNHUB_API_KEY`,
`TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GH_REPO`, `GH_TOKEN`.
