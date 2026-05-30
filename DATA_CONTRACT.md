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
  "scout_history":  { "<TICKER>": { "ts", "score", "grade" } },
  "scout_notified": { "<TICKER>": { "ts", "score", "grade" } }
}
```

Consumer behaviour: `results` → individual `dd:<TICKER>` keys (+ deletes `dd:live:<TICKER>`);
`index` → `dd:index`; `scouts`/`gems` → merged into `dd:scouts`/`dd:gems` (dedupe by
ticker, sort by score desc, cap 100); `scout_history`/`scout_notified` → `scout:history`/`scout:notified`.

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
| `positions:daryl` | `/api/positions` PUT | `/api/positions`, nav, sparks, news | portfolio |
| `nav:snapshots:v1` | `/api/nav-history` | same | daily NAV vs SPY |
| `sparks:v1` | `/api/sparks` | same | sparkline cache, TTL 30m |
| `news:tk:v15:<SYM>` | `/api/news` | same | per-ticker scored news |
| `wire:feed:v7` | `/api/wire` | same | editorial wire, TTL 20m |
| `dd:synthesis` | `/api/synthesis` | same | portfolio synthesis, TTL 30m |

## Supabase tables (written by sovereign-dd `upload_kv.py`)

- `dd_history`, `scout_history`, `gems_history` (needs creating — columns: ticker, score, grade, thesis, catalyst, fair_value, discovered_at), `news_archive` (written by eye news/wire endpoints).
