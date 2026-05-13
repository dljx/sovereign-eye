// Sovereign Eye — Root app

const { useState: useSA, useEffect: useEA, useMemo: useMA, useRef: useRA, useCallback: useCA } = React;

// ── Timezone / locale constants ────────────────────────────────────────────

const TZ_DISPLAY = "Asia/Singapore";   // SGT — user's local time
const TZ_MARKET  = "America/New_York"; // ET  — US market hours

function nowInTz(tz) {
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
}

// ── Market session (ET-aware) ──────────────────────────────────────────────

function getMarketSession() {
  const et = nowInTz(TZ_MARKET);
  const day = et.getDay(); // 0=Sun 6=Sat
  if (day === 0 || day === 6) return "CLOSED";
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins <  240) return "CLOSED";    // < 4:00 AM ET
  if (mins <  570) return "PRE-MKT";   // 4:00–9:30 AM ET
  if (mins <  960) return "OPEN";      // 9:30 AM–4:00 PM ET
  if (mins < 1200) return "AFTER-HRS"; // 4:00–8:00 PM ET
  return "CLOSED";
}

// Refresh interval in ms — faster during extended hours
function getRefreshMs(session) {
  if (session === "OPEN")      return 30_000;   // 30s during regular hours
  if (session === "PRE-MKT" || session === "AFTER-HRS") return 30_000; // 30s extended
  return 5 * 60_000; // 5 min when closed (overnight / weekend)
}

// ── USDSGD rate hook ──────────────────────────────────────────────────────

function useSGD() {
  const [rate, setRate] = useSA(1.35); // fallback approximate rate

  useEA(() => {
    // Frankfurter.app — free, no key, CORS-enabled
    fetch("https://api.frankfurter.app/latest?from=USD&to=SGD")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.rates?.SGD) setRate(d.rates.SGD); })
      .catch(() => {});
  }, []);

  return rate;
}

// ── Finnhub quote hook ─────────────────────────────────────────────────────

function useQuotes(positions) {
  const apiKey = window.SE_CONFIG?.CONFIG?.FINNHUB_API_KEY || "";

  // Seed with avg cost as placeholder price so table renders immediately
  const [quotes, setQuotes] = useSA(() => {
    const q = {};
    const seedQ = window.SE_CONFIG?.SEED_QUOTES || {};
    for (const p of positions) {
      q[p.ticker] = seedQ[p.ticker] || { c: p.avg || 0, d: 0, dp: 0, v: 0 };
    }
    return q;
  });

  const [lastRefresh, setLastRefresh] = useSA(() => new Date());
  const [quoteSrc, setQuoteSrc] = useSA("loading");
  const [session, setSession] = useSA(getMarketSession);
  const intervalRef = useRA(null);

  const fetchAll = useCA(async () => {
    const sess = getMarketSession();
    setSession(sess);

    if (!apiKey) { setQuoteSrc("no-key"); return; }
    const tickers = positions.map(p => p.ticker).filter(t => t && t !== "USD");

    try {
      const results = await Promise.all(
        tickers.map(t =>
          fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${apiKey}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );

      setQuotes(prev => {
        const next = { ...prev };
        tickers.forEach((t, i) => {
          const r = results[i];
          if (r && r.c > 0) {
            // Merge Finnhub data; preserve seed pe/eps/target if not in quote
            const seed = prev[t] || {};
            next[t] = {
              c: r.c, d: r.d ?? 0, dp: r.dp ?? 0,
              h: r.h, l: r.l, o: r.o, pc: r.pc, v: r.v,
              pe: seed.pe, eps: seed.eps, target: seed.target,
            };
          }
        });
        return next;
      });

      setLastRefresh(new Date());
      setQuoteSrc("live");
    } catch {
      setQuoteSrc("cached");
    }

    // Reschedule with new interval based on current session
    const nextMs = getRefreshMs(sess);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAll, nextMs);
  }, [positions, apiKey]);

  useEA(() => {
    fetchAll(); // immediate first fetch
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  return { quotes, lastRefresh, quoteSrc, session, refresh: fetchAll };
}

// ── Topbar ─────────────────────────────────────────────────────────────────

function Topbar({ totals, session, lastRefresh, sgdRate }) {
  const sessionClass = { OPEN: "mkt-open", "PRE-MKT": "mkt-pre", "AFTER-HRS": "mkt-after", CLOSED: "mkt-closed" }[session] || "mkt-closed";
  const now = new Date();
  const sgtTime = now.toLocaleTimeString("en-SG", { hour12: false, timeZone: TZ_DISPLAY });
  const sgtDate = now.toLocaleDateString("en-SG", { timeZone: TZ_DISPLAY, day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  const nlvSGD = totals.nlv * sgdRate;

  return (
    <div className="topbar">
      <div className="brand"><span className="dot"></span>SOVEREIGN&nbsp;EYE</div>
      <div className="seg">NLV <b>{fmtMoney(totals.nlv, 0)}</b></div>
      <div className="seg" style={{ color: "var(--fg-4)" }}>≈ <b style={{ color: "var(--fg-2)" }}>S${Math.round(nlvSGD).toLocaleString()}</b></div>
      <div className="seg">DAY <b style={{ color: totals.dayPct >= 0 ? "var(--pos)" : "var(--neg)" }}>
        {fmtPct(totals.dayPct)} · {fmtMoney(totals.dayPnl, 0)}
      </b></div>
      <div className="seg">PNL <b style={{ color: totals.pnl >= 0 ? "var(--pos)" : "var(--neg)" }}>
        {fmtMoney(totals.pnl, 0)} · {fmtPct(totals.pnlPct)}
      </b></div>
      <div className="seg">MKT <b className={sessionClass}>{session}</b></div>
      <div className="spacer"></div>
      <div className="seg">{sgtDate} · {sgtTime} <b style={{ color: "var(--fg-4)" }}>SGT</b></div>
      <span className="live"><span className="live-dot"></span>LIVE</span>
    </div>
  );
}

// ── StatusBar ──────────────────────────────────────────────────────────────

function StatusBar({ lastRefresh, hovered, totals, session, quoteSrc, sgdRate }) {
  const [, tick] = useSA(0);
  useEA(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const nextMs = getRefreshMs(session);
  const sinceRefresh = Date.now() - lastRefresh.getTime();
  const remaining = Math.max(0, Math.ceil((nextMs - sinceRefresh) / 1000));

  const extNote = (session === "PRE-MKT" || session === "AFTER-HRS")
    ? " · EXT HRS"
    : session === "CLOSED" ? " · OVERNIGHT" : "";

  return (
    <div className="statusbar">
      <span className="seg">PRICES @ <b>{lastRefresh.toLocaleTimeString("en-SG", { hour12: false, timeZone: TZ_DISPLAY })} SGT</b></span>
      <span className="seg">NEXT <b>{remaining}s</b></span>
      <span className="seg"><b style={{ color: quoteSrc === "live" ? "var(--pos)" : "var(--warn)" }}>{quoteSrc === "live" ? "FINNHUB OK" : quoteSrc === "loading" ? "LOADING…" : "CACHED"}</b>{extNote}</span>
      {hovered ? (
        <>
          <span className="seg" style={{ color: "var(--fg-4)" }}>│</span>
          <span className="seg">HOVER <b>{hovered.ticker}</b></span>
          <span className="seg">LAST <b>{fmtNum(hovered.last)}</b></span>
          <span className="seg">DAY <b className={hovered.dayPct >= 0 ? "pos" : "neg"}>{fmtPct(hovered.dayPct)} ({hovered.day >= 0 ? "+" : ""}{fmtNum(hovered.day)})</b></span>
          {hovered.volume > 0 && <span className="seg">VOL <b>{fmtCompact(hovered.volume)}</b></span>}
        </>
      ) : (
        <>
          <span className="seg" style={{ color: "var(--fg-4)" }}>│</span>
          <span className="seg" style={{ color: "var(--fg-4)" }}>HOVER A POSITION FOR LIVE QUOTE</span>
        </>
      )}
      <span className="spacer"></span>
      <span className="seg">POS <b>{totals.count}</b></span>
      <span className="seg">USD/SGD <b>{sgdRate.toFixed(4)}</b></span>
      <span className="live-pulse"><span className="live-dot"></span>AUTO {nextMs / 1000}s</span>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  // Normalise positions: accept both `avg` and `avgCost` field names
  const positions = useMA(() =>
    (window.SE_CONFIG?.MY_POSITIONS || []).map(p => ({
      ...p,
      avg: p.avg ?? p.avgCost ?? 0,
    }))
  , []);

  const tickers = useMA(() => positions.map(p => p.ticker).filter(t => t && t !== "USD"), [positions]);

  const { quotes, lastRefresh, quoteSrc, session } = useQuotes(positions);
  const sgdRate = useSGD();

  const [selectedTicker, setSelectedTicker] = useSA(null);
  const [hoveredTicker, setHoveredTicker] = useSA(null);

  // Enrich rows with live quote data
  const { rows, totals } = useMA(() => {
    let nlv = 0, costBasis = 0, dayPnl = 0;
    const enriched = positions.map(p => {
      const q = quotes[p.ticker] || {};
      const last = q.c > 0 ? q.c : p.avg;
      const day = q.d ?? 0;
      const dayPct = q.dp ?? 0;
      const value = last * p.qty;
      const cost = p.avg * p.qty;
      const pnl = value - cost;
      const pnlPct = cost ? (pnl / cost) * 100 : 0;
      nlv += value;
      costBasis += cost;
      dayPnl += day * p.qty;
      return { ...p, last, day, dayPct, value, pnl, pnlPct, volume: q.v, pe: q.pe, eps: q.eps, target: q.target };
    });
    for (const r of enriched) r.weight = nlv > 0 ? (r.value / nlv) * 100 : 0;
    const pnl = nlv - costBasis;
    return {
      rows: enriched,
      totals: {
        nlv, pnl,
        pnlPct: costBasis ? (pnl / costBasis) * 100 : 0,
        dayPnl,
        dayPct: (nlv - dayPnl) > 0 ? (dayPnl / (nlv - dayPnl)) * 100 : 0,
        count: enriched.length
      }
    };
  }, [positions, quotes]);

  const hovered = useMA(() => {
    if (!hoveredTicker) return null;
    return rows.find(r => r.ticker === hoveredTicker) || null;
  }, [hoveredTicker, rows]);

  return (
    <div className="app">
      <Topbar totals={totals} session={session} lastRefresh={lastRefresh} sgdRate={sgdRate} />

      <div className="grid">
        {/* Row 1: Inventory + Heatmap */}
        <div className="row row-1">
          <HoldingsInventory
            rows={rows} totals={totals}
            selectedTicker={selectedTicker} onSelectTicker={setSelectedTicker}
            hoveredTicker={hoveredTicker} onHoverTicker={setHoveredTicker}
          />
          <HoldingsHeatmap
            rows={rows}
            hoveredTicker={hoveredTicker} onHoverTicker={setHoveredTicker}
            onSelectTicker={setSelectedTicker}
          />
        </div>

        {/* Row 2: Intel + News + Macro */}
        <div className="row row-2">
          <IntelligenceFeed tickers={tickers} />
          <News tickers={tickers} />
          <MacroChart />
        </div>

        {/* Row 3: SEC + DD + Scout */}
        <div className="row row-3">
          <SECTracker tickers={tickers} />
          <SovereignDD ticker={selectedTicker} onTickerChange={setSelectedTicker} />
          <SovereignScout />
        </div>
      </div>

      <StatusBar
        lastRefresh={lastRefresh}
        session={session}
        quoteSrc={quoteSrc}
        totals={totals}
        sgdRate={sgdRate}
        hovered={hovered ? {
          ticker: hovered.ticker, last: hovered.last,
          day: hovered.day, dayPct: hovered.dayPct, volume: hovered.volume
        } : null}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
