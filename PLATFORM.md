# The Sovereign Platform

Two repos, one system: **sovereign-dd** (the analysis engine, Python on GitHub Actions)
finds and stress-tests stock ideas; **sovereign-eye** (the dashboard, Cloudflare Pages)
is where you see everything — portfolio, signals, verdicts, and real performance.

Objective: **beat VWRA or abstain.** Every feature exists to either generate a
defensible BUY signal, kill a bad one, or measure honestly whether the system earns
its keep.

```
finviz screens ─┐                                        ┌─ Telegram alerts
yfinance ───────┤   sovereign-dd (GitHub Actions)        │  (trades / deep dives /
Finnhub ────────┼─► dossier → 4-agent debate → gate ─────┼─  scans / ops)
Tiger OpenAPI ──┤   scoring → risk/reward → verdict      │
EDGAR / FRED ───┘                │                       └─ Supabase (signal history)
                                 ▼ upload (Bearer)
IBKR Flex ──┐        ┌───────────────────────────┐
Tiger API ──┼──────► │  sovereign-eye (CF Pages)  │ ◄── you (Basic auth,
 (read-only │        │  KV storage + API + React  │      desktop & mobile)
  broker    │        │  dashboard                 │
  sync)     └──────► └───────────────────────────┘
```

---

## sovereign-dd — the analysis engine

### Idea generation
- **Scout** (cron, ~every 4h): finviz-screened US market sweep → candidates scored
  and debated. Survivors land on the dashboard Scout board.
- **Gems**: same machinery pointed at small-cap deep value.
- **Portfolio run** (daily, pre-market): re-analyzes every held ticker (positions
  pulled live from the broker sync — no manual lists).
- **On-demand**: single-ticker or space-separated batch via workflow dispatch.

### The dossier (evidence pack, per ticker)
Fundamentals, statements, ROIC/DCF, technicals, momentum, insider activity, filings
(EDGAR), macro regime (FRED), peers, earnings calendar. **Source-ranked feeds
(2026-07-11):** Tiger delayed quotes + split-adjusted bars are primary for US symbols
(official API, no scrape fragility), Finnhub/yfinance fallback; ADR/FX correction;
every quote records which source served it.

### The debate
Four AI agents argue the ticker adversarially (bull/bear pairing) → consensus score
(0–10), grade, majority thesis, key swing factor, dissent spread. BUY threshold ≈ 7.0.

### The confirmation gate (v3, 2026-07-07)
Grades, not gates:
- **Stage 1** — machine QC only: convergence, score spread ≤ 2.0, confidence, failed
  agents, risk index, data confidence.
- **Stage 2** — a grounded red-team pass tries to break the thesis with live evidence.
- Verdicts: **CONFIRM** (surfaces clean), **DOWNGRADE** (surfaces ⚠-flagged with the
  strongest bear point), **VETO / REJECTED_STAGE1** (Under Review tab only).
- Honest semantics: CONFIRM means *one adversarial pass found no thesis-breaking
  flaw* — it is not a guarantee. Whether CONFIRM actually outperforms DOWNGRADE is
  the pre-registered scoreboard question (~2026-09-15 read).

### Signal outcome tracking
Every surfaced signal is written to Supabase with signal-time price/factors.
`signal_analysis.py` measures forward returns at 1/4/12/26/52 weeks vs benchmarks —
the referee for every methodology change (changes require pre-registration).

### Broker sync (read-only, daily 09:35 UTC Tue–Sat)
- **IBKR** Flex Web Service (statement token — structurally cannot trade) and
  **Tiger** OpenAPI (query-methods-only contract; `broker_sync.py` is the sole key
  consumer). Positions + cash → dashboard portfolio (100% API-derived; broker truth
  wins).
- **NAV history (2026-07-11)**: daily account NAV, deposits/withdrawals, and income
  (dividends/withholding/fees) from both brokers — Tiger back to 2021, IBKR 365d —
  converted to USD (IBKR base is SGD) with refuse-don't-corrupt guards.
- `--probe` mode: read-only capability diagnostic for both broker APIs.

### Ops
Telegram topics (trade alerts, deep dives, scan results, watchlist, ops alerts);
fail-loud ledgers; KV write budgeting (free tier, 1,000/day); live debate events
streamed to the dashboard for watched runs.

---

## sovereign-eye — the dashboard

Cloudflare Pages + Functions + KV. React (esbuild), separate desktop and mobile UIs.
Browser access via Basic auth; the pipeline authenticates with a Bearer secret on an
allow-listed set of endpoints.

### Boards & analysis views
- **Scout / Gems boards**: BUY cards with score, 🛡/⚠ verdict chips, R:R, age stamp
  (14-day auto-expiry — stale cards fall off), `unverified` and **"ER in Nd"**
  pre-earnings chips. Card → full dossier view (`#dd` route) with debate transcript.
- **Under Review**: VETO'd and stage-1-rejected names with reasons — the "why not"
  audit trail.
- **Debate room**: live agent-by-agent stream while an analysis runs.
- **Scoreboard**: signal hit-rates and forward returns by window.

### Portfolio & performance
- **Positions**: broker-synced holdings, live quotes (`/api/quotes` — Finnhub +
  Yahoo fallback, FX-normalized to USD, edge-cached), treemap, sparklines.
- **Macro panel**: real broker NAV vs **SPY and VWRA** (dashed), with flow-adjusted
  **TWR** and a "beats/trails VWRA by X pp" verdict — deposits stripped out, so the
  number is return, not savings.
- **FIRE tab**: FIRE number & crossover projection, full CPF simulation (official
  2026 OA/SA/MA rules), broker-reported income line, settings synced server-side
  with device fallback.

### News & context
- **News / Wire / Filings**: per-holding scored news, editorial wire, EDGAR filings.
- **Synthesis**: portfolio-level catalysts / risks / macro digest.

### Plumbing worth knowing
- KV is the single store (`DATA_CONTRACT.md` documents every key). Boards are
  merge-and-age-out; positions and NAV are broker-scoped (one broker's outage can
  never wipe another's data).
- GETs are edge-cached (quotes 25s, dossier reads ≤1h); uploads purge per-ticker.
- Auto-deploys on push to master (`deploy.yml`).

---

## Standing rules
- Broker credentials live only in GitHub secrets; the Tiger key never enters
  Cloudflare; `broker_sync.py` is the only Tiger client constructor and calls query
  methods only.
- Gate/scoring methodology changes require pre-registration before shipping
  (scoreboard integrity); display/ops changes are exempt.
- Data that can't be verified ships as "unknown", never as a guess — refusing to
  write beats writing something wrong.
