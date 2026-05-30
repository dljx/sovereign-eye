# Architecture — Sovereign Eye + Sovereign DD

Two sibling repos that form one system.

## Data flow

```
 sovereign-dd (Python, GitHub Actions)                sovereign-eye (Cloudflare Pages)
 ─────────────────────────────────────                ────────────────────────────────
  scout.py / gems.py / main.py  ── screen + debate
            │  writes output/*.json
            ▼
  upload_kv.py  ──── POST /api/dd/upload ───────────▶  functions/api/dd/upload.js
            │        (Bearer DD_UPLOAD_SECRET)                  │ writes Cloudflare KV (DD_KV)
            │                                                   ▼
            └──── Supabase REST (dd_history,            functions/api/dd/*.js  ◀── dashboard
                  scout_history, gems_history,                  (reads KV + Supabase)
                  news_archive)                                 .jsx panels render
```

- **sovereign-dd** runs on schedule (`analyze.yml` weekday pre-market; `scout.yml` every 4h) plus on-demand via `workflow_dispatch`.
- It pushes results to **sovereign-eye** at `POST /api/dd/upload` (auth: `Bearer DD_UPLOAD_SECRET`), which writes Cloudflare **KV** (`DD_KV`). It also writes **Supabase** history tables directly.
- **sovereign-eye** is the dashboard: `functions/api/*.js` are Cloudflare Pages Functions; the frontend is React loaded via Babel-in-browser (no build step) from `index.html` (desktop) / `mobile.html` (mobile).

## Integration points (sovereign-eye endpoints)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/dd/upload` | Bearer `DD_UPLOAD_SECRET` | dd pushes results → KV |
| `GET /api/dd/history` | Bearer `DD_UPLOAD_SECRET` | dd recovers scout history on cold CI cache |
| `POST /api/dd/live` | Bearer `DD_UPLOAD_SECRET` | dd streams live debate events |
| `POST /api/dd/trigger` | Basic (dashboard) | dashboard dispatches a GitHub Actions run |
| `GET /api/dd/{index,scouts,gems,:ticker,live/:ticker,trend}` | Basic | dashboard reads |
| everything else (`/api/*`) | Basic (`_middleware.js`) | dashboard data |

`SOVEREIGN_EYE_URL` in dd points at the production apex `https://sovereign-eye.pages.dev` so uploads are independent of Pages branch aliases. KV (`DD_KV`) is bound at the **project** level, so all deployments share one namespace.

See **DATA_CONTRACT.md** for the upload payload shape and every KV key.

## Deploy

sovereign-eye deploys via `./deploy.sh` (wraps `wrangler pages deploy . --branch=<prod>`; auto-bumps `?v=` cache tags). Pages is **not** git-connected — the working tree is deployed, the `--branch` flag is just the production-alias label. sovereign-dd is not deployed; it runs in GitHub Actions off whatever is on its branch.

> Branch note: production currently maps to `main` in the Cloudflare dashboard, but repo history lives on `master`. Pick one canonical branch and set it as the Pages production branch to remove the ambiguity.
