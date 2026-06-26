# Data Contract — sovereign-dd ⇄ sovereign-eye

The implicit JSON contract between `sovereign-dd/upload_kv.py` (producer) and
`sovereign-eye/functions/api/dd/upload.js` (consumer). Keep both sides in sync.

## `POST /api/dd/upload` payload

```jsonc
{
  "results":  [ { "key": "dd:<TICKER>", "value": { "result": {...}, "dossier": {...} } } ],
  "index":    { "<TICKER>": { "score", "grade", "conf", "updated", "loops", "spread" } },
  "scouts":   [ { "ticker", "score", "grade", "conf", "thesis", "key_swing",
                  "catalyst", "asymmetry_ratio", "banger", "position_guidance",
                  "cycle_position", "matched_filters", "path", "analyzed_at" } ],
  "gems":     [ /* same shape as a scout discovery */ ],
  "reconcile_remove": [ "<TICKER>", ... ],   // tickers re-analyzed below threshold
  "scout_history":  { "<TICKER>": { "ts", "score", "grade" } },
  "scout_notified": { "<TICKER>": { "ts", "score", "grade" } }
}
```

Consumer behaviour: `results` → individual `dd:<TICKER>` keys (+ deletes `dd:live:<TICKER>`);
`index` → `dd:index`; `scouts`/`gems` → merged into `dd:scouts`/`dd:gems` (dedupe by
ticker, sort by score desc, cap 100); `reconcile_remove` → those tickers are deleted
from BOTH `dd:scouts` and `dd:gems` (applied AFTER the upserts, so a same-run
qualifying result is never undone); `scout_history`/`scout_notified` → `scout:history`/`scout:notified`.

**Scout-card freshness rule:** any analyzed ticker (scout/gems screener OR a manual
`analyze` trigger OR a `--portfolio` run) scoring ≥ `BUY_THRESHOLD` upserts/refreshes
its `dd:scouts` card with that run's data; scoring below threshold removes the card.
So the Scout board always reflects the latest analysis of each ticker.

> **Any field the consumer doesn't destructure is silently dropped.** If you add a field
> in `upload_kv.py`, add it in `upload.js` too. (This is exactly how `gems` was a dead path.)

## KV keys (namespace `DD_KV`)

| Key | Writer | Reader | Notes |
|---|---|---|---|
| `dd:index` | upload.js | `/api/dd/index` | per-ticker summary map |
| `dd:<TICKER>` | upload.js | `/api/dd/:ticker` | full result + dossier |
| `dd:scouts` | upload.js | `/api/dd/scouts` | accumulated BUY list, cap 100 |
| `dd:gems` | upload.js | `/api/dd/gems` | accumulated gems BUY list, cap 100 |
| `dd:live:<TICKER>` | `/api/dd/live` POST | `/api/dd/live/:ticker` | live debate events, TTL 1h |
| `scout:history` / `scout:notified` | upload.js | `/api/dd/history` | CI cold-cache recovery |
| `positions:daryl` | `/api/positions` PUT | `/api/positions`, nav, sparks, news, **`/api/dd/positions`** | portfolio (source of truth for the pre-market screen) |
| `nav:snapshots:v1` | `/api/nav-history` | same | daily NAV vs SPY |
| `sparks:v1` | `/api/sparks` | same | sparkline cache, TTL 30m |
| `news:tk:v15:<SYM>` | `/api/news` | same | per-ticker scored news |
| `wire:feed:v7` | `/api/wire` | same | editorial wire, TTL 20m |
| `dd:synthesis` | `/api/synthesis` | same | portfolio synthesis, TTL 30m |

## Pre-market screen ticker source

`sovereign-dd` `main.py._portfolio_tickers()` fetches **`GET /api/dd/positions`**
(Bearer `DD_UPLOAD_SECRET`) → `{ "tickers": [...] }`, derived from `positions:daryl`.
That live list is the source of truth for `--portfolio` and the portfolio-aware
scout path. The hardcoded `PORTFOLIO_TICKERS` env (in `analyze.yml` / `scout.yml`)
is only a **fallback** used when the endpoint is unconfigured / unreachable / empty.
So editing holdings on the dashboard changes what the next pre-market screen analyzes.

## Supabase tables (written by sovereign-dd `upload_kv.py`)

- `dd_history` — one row per portfolio/hold-mode debate: `ticker, run_at, price, composite_fv, result_fv, mos, score, grade, confidence, archetype, agent_scores, thesis, swing, is_banger, full_result`.
- `scout_history` — one row per scout discovery (append-only signal log): `ticker, score, grade, sector, path, filters, thesis, price, confirmed, verdict, discovered_at`.
- `gems_history` — one row per gems discovery: `ticker, score, grade, thesis, catalyst, fair_value, price, confirmed, verdict, discovered_at`.
- `news_archive` — written by eye news/wire endpoints.

> `price` = market price at signal time (the anchor for forward-return / hit-rate analysis);
> `confirmed` + `verdict` = BUY-confirmation-gate outcome (lets you measure whether the gate adds edge).
> Added 2026-06-26. Producer rows are built by `_scout_history_row` / `_gems_history_row` in `upload_kv.py`
> — add a column to the table **before** adding the field there, or PostgREST drops the whole insert.
