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

    const tickers = positions.map(p => p.ticker).filter(t => t && t !== "USD");
    if (!tickers.length) return;

    try {
      // Try server-side proxy first (keeps API key out of client JS)
      let quotesMap = null;
      const proxyRes = await fetch(`/api/quotes?tickers=${tickers.join(",")}`).catch(() => null);
      if (proxyRes?.ok) {
        quotesMap = await proxyRes.json();
      } else if (apiKey) {
        // Fallback: direct Finnhub with client-side key (local dev only)
        const results = await Promise.all(
          tickers.map(t =>
            fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${apiKey}`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        );
        quotesMap = {};
        tickers.forEach((t, i) => { if (results[i]?.c > 0) quotesMap[t] = results[i]; });
      }

      if (quotesMap && Object.keys(quotesMap).length) {
        setQuotes(prev => {
          const next = { ...prev };
          tickers.forEach(t => {
            const r = quotesMap[t];
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
      }
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

// ── Portfolio import helpers ───────────────────────────────────────────────

function computeDiff(current, incoming) {
  const curMap = new Map(current.map(p => [p.ticker, p]));
  const incMap = new Map(incoming.map(p => [p.ticker, p]));
  return {
    adds:     incoming.filter(p => !curMap.has(p.ticker)),
    updates:  incoming.filter(p => {
      const e = curMap.get(p.ticker);
      return e && (Math.abs(e.qty - p.qty) > 0.001 || Math.abs((e.avg || 0) - p.avg) > 0.01);
    }),
    removals: current.filter(p => !incMap.has(p.ticker)),
  };
}

function ImportModal({ positions, onClose, onSave }) {
  const [state, setState] = useSA("idle"); // idle|loading|preview|saving|saved|error
  const [diff, setDiff] = useSA(null);
  const [partial, setPartial] = useSA(false);
  const [removalsChecked, setRemovalsChecked] = useSA({});
  const [errMsg, setErrMsg] = useSA("");
  const [incoming, setIncoming] = useSA(null);
  const [dragOver, setDragOver] = useSA(false);
  const fileRef = useRA(null);

  const parse = useCA(async (file) => {
    setState("loading");
    setErrMsg("");
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const mimeType = file.type || "image/jpeg";
      const r = await fetch("/api/portfolio/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: base64, mimeType }),
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw new Error(result.error || `HTTP ${r.status}`);
      const d = computeDiff(positions, result.positions);
      setIncoming(result.positions);
      setDiff(d);
      setPartial(result.partial);
      setRemovalsChecked({});
      setState("preview");
    } catch (e) {
      setErrMsg(e.message);
      setState("error");
    }
  }, [positions]);

  const handleFile = useCA((file) => {
    if (file && file.type.startsWith("image/")) parse(file);
  }, [parse]);

  const confirm = useCA(async () => {
    if (!diff) return;
    setState("saving");
    const curMap = new Map(positions.map(p => [p.ticker, p]));
    for (const p of [...diff.adds, ...diff.updates]) {
      const existing = curMap.get(p.ticker) || {};
      curMap.set(p.ticker, {
        ...existing, ...p,
        sector:   p.sector   || existing.sector   || "",
        industry: p.industry || existing.industry || "",
      });
    }
    for (const p of diff.removals) {
      if (removalsChecked[p.ticker]) curMap.delete(p.ticker);
    }
    const merged = [...curMap.values()];
    try {
      const r = await fetch("/api/positions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      if (!r.ok) throw new Error(`Save failed HTTP ${r.status}`);
      onSave(merged.map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 })));
      setState("saved");
      setTimeout(onClose, 1800);
    } catch (e) {
      setErrMsg(e.message);
      setState("error");
    }
  }, [diff, removalsChecked, positions, onSave, onClose]);

  const totalChanges = diff
    ? diff.adds.length + diff.updates.length + Object.values(removalsChecked).filter(Boolean).length
    : 0;

  return (
    <div className="import-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="import-card">
        <h2>Import from Screenshot</h2>

        {state === "idle" && (
          <div
            className={"import-dropzone" + (dragOver ? " drag-over" : "")}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <div className="drop-icon">↑</div>
            <div className="drop-hint">DROP SCREENSHOT OR CLICK TO UPLOAD</div>
            <div className="drop-sub">IBKR · TIGER · JPEG / PNG / WEBP</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])} />
          </div>
        )}

        {state === "loading" && (
          <div className="import-status">GEMINI PARSING…</div>
        )}

        {state === "preview" && diff && (
          <>
            {partial && (
              <div className="diff-partial">
                ⚠ PARTIAL SCREENSHOT — positions not visible in this screenshot are listed as
                removals below but are unchecked by default. Only check removals you have confirmed as sold.
              </div>
            )}

            {diff.adds.length > 0 && (
              <div className="diff-section diff-add">
                <div className="diff-section-label">+ ADDS ({diff.adds.length})</div>
                {diff.adds.map(p => (
                  <div className="diff-row" key={p.ticker}>
                    <span className="d-tk">{p.ticker}</span>
                    <span className="d-name">{p.name}</span>
                    <span className="d-val">{p.qty} sh @ ${p.avg.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {diff.updates.length > 0 && (
              <div className="diff-section diff-upd">
                <div className="diff-section-label">~ UPDATES ({diff.updates.length})</div>
                {diff.updates.map(p => {
                  const old = positions.find(x => x.ticker === p.ticker) || {};
                  return (
                    <div className="diff-row" key={p.ticker}>
                      <span className="d-tk">{p.ticker}</span>
                      <span className="d-name">{p.name}</span>
                      <span className="d-val">
                        <span className="d-old">{old.qty}sh @${(old.avg||0).toFixed(2)}</span>
                        {p.qty}sh @${p.avg.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {diff.removals.length > 0 && (
              <div className="diff-section diff-rem">
                <div className="diff-section-label">− REMOVALS (check to confirm sold)</div>
                {diff.removals.map(p => (
                  <div className="diff-row" key={p.ticker}>
                    <input type="checkbox" checked={!!removalsChecked[p.ticker]}
                      onChange={(e) => setRemovalsChecked(s => ({ ...s, [p.ticker]: e.target.checked }))} />
                    <span className="d-tk">{p.ticker}</span>
                    <span className="d-name">{p.name}</span>
                    <span className="d-val">{p.qty} sh</span>
                  </div>
                ))}
              </div>
            )}

            {diff.adds.length === 0 && diff.updates.length === 0 && diff.removals.length === 0 && (
              <div className="import-status">No changes detected — portfolio is already in sync.</div>
            )}

            <div className="import-actions">
              <button className="import-actions button import-btn-cancel" onClick={onClose}>CANCEL</button>
              <button className="import-actions button import-btn-save"
                onClick={confirm} disabled={totalChanges === 0}>
                SAVE {totalChanges} CHANGE{totalChanges !== 1 ? "S" : ""}
              </button>
            </div>
          </>
        )}

        {state === "saving" && <div className="import-status">SAVING…</div>}

        {state === "saved" && <div className="import-status ok">✓ SAVED</div>}

        {state === "error" && (
          <div>
            <div className="import-status err">ERROR: {errMsg}</div>
            <div className="import-actions">
              <button className="import-actions button import-btn-cancel" onClick={onClose}>CLOSE</button>
              <button className="import-actions button import-btn-save"
                onClick={() => setState("idle")}>RETRY</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  // Normalise positions: accept both `avg` and `avgCost` field names.
  // Initialise from static positions.js, then overwrite with KV on mount.
  const [positions, setPositions] = useSA(() =>
    (window.SE_CONFIG?.MY_POSITIONS || []).map(p => ({
      ...p,
      avg: p.avg ?? p.avgCost ?? 0,
    }))
  );

  useEA(() => {
    fetch("/api/positions")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length)
          setPositions(data.map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 })));
      })
      .catch(() => {});
  }, []);

  const [importOpen, setImportOpen] = useSA(false);

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
      {importOpen && (
        <ImportModal
          positions={positions}
          onClose={() => setImportOpen(false)}
          onSave={setPositions}
        />
      )}

      <Topbar totals={totals} session={session} lastRefresh={lastRefresh} sgdRate={sgdRate} />

      <div className="grid">
        {/* Row 1: Inventory + Heatmap */}
        <div className="row row-1">
          <HoldingsInventory
            rows={rows} totals={totals}
            selectedTicker={selectedTicker} onSelectTicker={setSelectedTicker}
            hoveredTicker={hoveredTicker} onHoverTicker={setHoveredTicker}
            onImport={() => setImportOpen(true)}
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
