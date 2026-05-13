// ─────────── Sovereign Engine v1.0 — Portfolio Intelligence Dashboard ───────────
// Manual entry with localStorage persistence + live Finnhub data.

const { useState, useMemo, useRef, useEffect, useCallback, useContext, createContext } = React;
const { MY_POSITIONS: SEED, CONFIG, SECTOR_COLORS, SECTOR_OPTIONS, SYNTHESIS, MACRO_SERIES, SEC_SEED, NEWS_SEED, WIRE_SEED } = window.SE_CONFIG;

const STORAGE_KEY = "se-positions-v1";

// ─────────── Finnhub API helpers ───────────
const FH = "https://finnhub.io/api/v1";
const fhUrl = (path, params = "") =>
  `${FH}${path}?token=${CONFIG.FINNHUB_API_KEY}${params ? "&" + params : ""}`;

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchQuotes(tickers) {
  const symbols = tickers.filter(t => t !== "USD");
  const map = {};
  for (const sym of symbols) {
    try {
      const res = await fetch(fhUrl("/quote", `symbol=${sym}`));
      if (res.ok) {
        const q = await res.json();
        if (q && q.c) {
          map[sym] = {
            price: q.c, prevClose: q.pc,
            change: q.d, changePercent: q.dp,
            high: q.h, low: q.l, open: q.o,
          };
        }
      }
      await delay(120);
    } catch (e) {
      console.warn(`Quote fetch failed for ${sym}:`, e.message);
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

async function fetchCompanyProfile(ticker) {
  try {
    const res = await fetch(fhUrl("/stock/profile2", `symbol=${ticker}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ticker ? data : null;
  } catch { return null; }
}

async function fetchBasicFinancials(ticker) {
  try {
    const res = await fetch(fhUrl("/stock/metric", `symbol=${ticker}&metric=all`));
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.metric ? data.metric : null;
  } catch { return null; }
}

async function fetchNews(tickers) {
  const symbols = tickers.filter(t => t !== "USD").slice(0, 5);
  const results = [];
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  for (const sym of symbols) {
    try {
      const res = await fetch(fhUrl("/company-news", `symbol=${sym}&from=${weekAgo}&to=${today}`));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.slice(0, 2).forEach(n => results.push({ ...n, ticker: sym }));
        }
      }
      await delay(120);
    } catch { /* skip */ }
  }
  return results.sort((a, b) => (b.datetime || 0) - (a.datetime || 0)).slice(0, 8);
}

async function fetchSECFilings(tickers) {
  const symbols = tickers.filter(t => t !== "USD").slice(0, 6);
  const results = [];
  for (const sym of symbols) {
    try {
      const res = await fetch(fhUrl("/stock/filings", `symbol=${sym}&limit=2`));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.forEach(f => results.push({ ...f, ticker: sym }));
        }
      }
      await delay(120);
    } catch { /* skip */ }
  }
  return results.sort((a, b) => new Date(b.filedDate || b.acceptedDate || 0) - new Date(a.filedDate || a.acceptedDate || 0)).slice(0, 8);
}

// ─────────── Formatting helpers ───────────
const fmtMoney = (n, d = 2) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n/1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n/1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n/1e3).toFixed(1) + "K";
  return n.toFixed(0);
};
const fmtPct = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d) + "%";

const heatColor = (pct) => {
  const t = Math.max(-5, Math.min(5, pct)) / 5;
  if (t >= 0) return `rgba(34, 197, 94, ${(0.18 + t*0.55).toFixed(3)})`;
  return `rgba(239, 68, 68, ${(0.18 + (-t)*0.55).toFixed(3)})`;
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─────────── Positions store (KV + localStorage) ───────────
// Sync helper: reads from KV on mount, falls back to localStorage then seed.
// Saves to both localStorage (sync) and KV (async, fire-and-forget) on every change.

async function fetchPositionsFromKV() {
  try {
    const res = await fetch("/api/positions");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) { /* offline or KV not yet configured */ }
  return null;
}

function savePositionsToKV(positions) {
  fetch("/api/positions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(positions),
  }).catch(() => { /* fire-and-forget */ });
}

const loadPositions = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {}
  return SEED;
};

const PortfolioCtx = createContext(null);

// ─────────── Loading Screen ───────────
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="mark"></div>
      <div className="title">SOVEREIGN ENGINE</div>
      <div className="sub">FETCHING LIVE MARKET DATA...</div>
      <div className="loading-spinner"></div>
    </div>
  );
}

// ─────────── Command bar ───────────
function CommandBar() {
  const { totalEq, totalCost, totalUpl, totalUplP, dayPL, dayPLP, portBeta, brokers, brokerEq, sectorBreakdown, fxRate } = useContext(PortfolioCtx);
  const [now, setNow] = useState(new Date());
  const [ccy, setCcy] = useState("USD");
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const ts = now.toISOString().replace("T", " ").slice(0, 19) + "Z";
  const top = sectorBreakdown[0];

  const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = nyNow.getHours(), m = nyNow.getMinutes();
  const day = nyNow.getDay();
  const isOpen = day >= 1 && day <= 5 && (h > 9 || (h === 9 && m >= 30)) && h < 16;

  const isSGD = ccy === "SGD";
  const fx = (isSGD && fxRate) ? fxRate : 1;
  const sym = isSGD ? "S$" : "$";
  const ccyLabel = isSGD ? "SGD" : "USD";

  return (
    <div className="cmd">
      <div className="brand">
        <div className="mark"></div>
        <div>
          <div className="name">SOVEREIGN ENGINE<span className="ver">v1.0</span></div>
          <div style={{fontFamily:"var(--mono)", fontSize:9.5, color:"var(--fg-3)", letterSpacing:"0.1em", marginTop:2}}>PORTFOLIO INTELLIGENCE · READ-ONLY</div>
        </div>
      </div>

      <div className="cmd-stats">
        <div className="stat" style={{minWidth:280}}>
          <div className="lbl">TOTAL NET LIQUIDITY <span className="src">{ccyLabel} · CONSOLIDATED</span>
            <span onClick={() => setCcy(c => c === "USD" ? "SGD" : "USD")} style={{marginLeft:8, cursor:"pointer", padding:"1px 6px", borderRadius:3, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", fontSize:9, letterSpacing:"0.05em", color:"var(--fg-2)", userSelect:"none"}}>
              {isSGD ? "USD" : "SGD"}
            </span>
          </div>
          <div className="val">{sym}{fmtMoney(totalEq * fx, 0)}<span className="sub">Cost {sym}{fmtCompact(totalCost * fx)}</span></div>
          <div className={"delta " + (totalUpl >= 0 ? "pl-pos" : "pl-neg")}>
            {fmtPct(totalUplP)} unrealized · {sym}{fmtMoney(totalUpl * fx, 0)}
          </div>
          {isSGD && fxRate && (
            <div className="delta fg-2" style={{marginTop:2, fontSize:9.5}}>
              1 USD = {fxRate.toFixed(4)} SGD
            </div>
          )}
        </div>
        <div className={"stat " + (dayPL >= 0 ? "pos" : "neg")} style={{minWidth:200}}>
          <div className="lbl">24H P/L <span className="src">VS. PREV CLOSE</span></div>
          <div className="val">{dayPL >= 0 ? "+" : ""}{sym}{fmtMoney(Math.abs(dayPL) * fx, 0)}</div>
          <div className="delta">{fmtPct(dayPLP)} · {dayPL >= 0 ? "▲" : "▼"} session</div>
        </div>
        <div className="stat" style={{minWidth:180}}>
          <div className="lbl">PORTFOLIO BETA <span className="src">vs SPX · 90D</span></div>
          <div className="val">{portBeta.toFixed(2)}<span className="sub">σ {(portBeta*16).toFixed(1)}%</span></div>
          <div className="delta fg-2">{top ? `${top.sector} ${top.pct.toFixed(1)}% · ${sectorBreakdown.length} sectors` : "—"}</div>
        </div>
        <div className="stat" style={{minWidth:200}}>
          <div className="lbl">BROKER SPLIT <span className="src">{brokers.length} ACCOUNT{brokers.length !== 1 ? "S" : ""}</span></div>
          <div className="val" style={{fontSize:13, lineHeight:1.3, display:"block"}}>
            {brokers.slice(0, 2).map(b => (
              <div key={b} style={{display:"flex", justifyContent:"space-between", gap:10, fontFamily:"var(--mono)"}}>
                <span style={{color:"var(--fg-2)"}}>{b.toUpperCase()}</span>
                <span>{totalEq ? ((brokerEq[b]/totalEq)*100).toFixed(1) : "0.0"}%</span>
              </div>
            ))}
            {brokers.length > 2 && (
              <div style={{display:"flex", justifyContent:"space-between", gap:10, fontFamily:"var(--mono)", color:"var(--fg-3)", fontSize:11}}>
                <span>+{brokers.length - 2} OTHER</span>
                <span>{totalEq ? (brokers.slice(2).reduce((s,b)=>s+brokerEq[b],0)/totalEq*100).toFixed(1) : "0.0"}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="session">
        <div className="live"><span className="dot" style={{background: isOpen ? "var(--pos)" : "var(--fg-3)"}}></span>{isOpen ? "NYSE · OPEN" : "NYSE · CLOSED"}</div>
        <div>{ts}</div>
      </div>
    </div>
  );
}

// ─────────── Sub bar ───────────
function SubBar({ dataStatus, lastSync, kvConnected }) {
  const { rows, fxRate } = useContext(PortfolioCtx);
  const sources = [
    { name: "MANUAL ENTRY", ok: true },
    { name: "FINNHUB QUOTES", ok: dataStatus.quotes },
    { name: "FINNHUB NEWS", ok: dataStatus.news },
    { name: "FINNHUB SEC", ok: dataStatus.sec },
  ];
  const syncAgo = lastSync ? Math.floor((Date.now() - lastSync) / 1000) : "—";
  const sectors = new Set(rows.map(r => r.sector));
  return (
    <div className="subbar">
      {sources.map(s => (
        <span key={s.name} className="pill">
          <span className={s.ok ? "ok" : "err"}></span>{s.name}
        </span>
      ))}
      <span className="spacer"></span>
      <span className="meta">
        <span>POS <b>{rows.length}</b></span>
        <span>SECTORS <b>{sectors.size}</b></span>
        <span>FX <b>USD/SGD {fxRate ? fxRate.toFixed(4) : "…"}</b></span>
        <span>STORAGE <b>{kvConnected ? "KV + localStorage" : "localStorage"}</b></span>
        <span>LAST SYNC <b>{typeof syncAgo === "number" ? syncAgo + "s" : syncAgo}</b></span>
      </span>
    </div>
  );
}

// ─────────── Finnhub sector mapping ───────────
const FINNHUB_SECTOR_MAP = {
  "Technology": "Tech",
  "Financial Services": "Financials",
  "Healthcare": "Healthcare",
  "Consumer Cyclical": "Cons. Disc.",
  "Consumer Defensive": "Cons. Stap.",
  "Energy": "Energy",
  "Industrials": "Industrials",
  "Basic Materials": "Materials",
  "Utilities": "Utilities",
  "Real Estate": "Real Estate",
  "Communication Services": "Comm.",
};

// ─────────── Add Position form ───────────
function AddPositionForm({ onAdd, onCancel, brokers }) {
  const [ticker, setTicker]   = useState("");
  const [name, setName]       = useState("");
  const [broker, setBroker]   = useState(brokers[0] || "Manual");
  const [customBroker, setCustomBroker] = useState("");
  const [qty, setQty]         = useState("");
  const [avg, setAvg]         = useState("");
  const [sector, setSector]   = useState("");
  const [industry, setIndustry] = useState("");
  const [err, setErr]         = useState("");
  const [lookupStatus, setLookupStatus] = useState(""); // "", "loading", "found", "not-found"
  const lookupTimer = useRef(null);

  const tickerRef = useRef(null);
  useEffect(() => { tickerRef.current?.focus(); }, []);

  // Auto-lookup ticker info from Finnhub when user types a ticker
  const lookupTicker = useCallback(async (tk) => {
    if (!tk || tk.length < 1) {
      setLookupStatus("");
      return;
    }
    setLookupStatus("loading");
    try {
      const profile = await fetchCompanyProfile(tk);
      if (profile) {
        if (!name) setName(profile.name || "");
        const mappedSector = FINNHUB_SECTOR_MAP[profile.finnhubIndustry] || "";
        if (!sector) setSector(mappedSector || "Tech");
        if (!industry) setIndustry(profile.finnhubIndustry || "");
        setLookupStatus("found");
      } else {
        setLookupStatus("not-found");
      }
    } catch {
      setLookupStatus("not-found");
    }
  }, [name, sector, industry]);

  const onTickerChange = (e) => {
    const val = e.target.value;
    setTicker(val);
    setErr("");
    // Debounce the lookup
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const tk = val.trim().toUpperCase();
    if (tk.length >= 1) {
      lookupTimer.current = setTimeout(() => lookupTicker(tk), 600);
    } else {
      setLookupStatus("");
    }
  };

  const submit = (e) => {
    e?.preventDefault();
    const tk = ticker.trim().toUpperCase();
    if (!tk) return setErr("Ticker required");
    if (!qty || +qty <= 0) return setErr("Quantity must be > 0");
    if (!avg || +avg <= 0) return setErr("Avg cost must be > 0");
    const useBroker = broker === "__custom" ? customBroker.trim() : broker;
    if (!useBroker) return setErr("Broker required");
    onAdd({
      ticker: tk,
      name: name.trim() || tk,
      broker: useBroker,
      qty: +qty,
      avg: +avg,
      sector: sector || "Tech",
      industry: industry.trim() || sector || "Tech",
    });
  };

  return (
    <form className="addform" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="addform-grid" style={{gridTemplateColumns:"120px 1fr 1fr"}}>
        <div className="addform-row">
          <label>Ticker {lookupStatus === "loading" ? <span style={{color:"var(--acc)"}}>· looking up…</span> : lookupStatus === "found" ? <span style={{color:"var(--pos)"}}>· found</span> : lookupStatus === "not-found" ? <span style={{color:"var(--fg-4)"}}>· manual</span> : ""}</label>
          <input ref={tickerRef} value={ticker} onChange={onTickerChange} placeholder="NVDA" maxLength={6} style={{textTransform:"uppercase"}} />
        </div>
        <div className="addform-row">
          <label>Qty</label>
          <input type="number" step="any" value={qty} onChange={(e) => { setQty(e.target.value); setErr(""); }} placeholder="100" />
        </div>
        <div className="addform-row">
          <label>Avg Cost</label>
          <input type="number" step="any" value={avg} onChange={(e) => { setAvg(e.target.value); setErr(""); }} placeholder="120.50" />
        </div>
      </div>
      <div className="addform-grid" style={{gridTemplateColumns:"1fr 120px"}}>
        <div className="addform-row">
          <label>Company Name <span style={{color:"var(--fg-4)"}}>· auto</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="auto-filled from Finnhub" />
        </div>
        <div className="addform-row">
          <label>Broker</label>
          <select value={broker} onChange={(e) => setBroker(e.target.value)}>
            {brokers.map(b => <option key={b} value={b}>{b}</option>)}
            <option value="__custom">+ Add new…</option>
          </select>
          {broker === "__custom" && (
            <input value={customBroker} onChange={(e) => setCustomBroker(e.target.value)} placeholder="e.g. Schwab" style={{marginTop:6}} />
          )}
        </div>
      </div>
      <div className="addform-grid">
        <div className="addform-row">
          <label>Sector <span style={{color:"var(--fg-4)"}}>· auto</span></label>
          <select value={sector || "Tech"} onChange={(e) => setSector(e.target.value)}>
            {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="addform-row">
          <label>Industry <span style={{color:"var(--fg-4)"}}>· auto</span></label>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="auto-filled" />
        </div>
        <div className="addform-row">
          <label>Beta <span style={{color:"var(--fg-4)"}}>· auto</span></label>
          <input disabled value="auto from Finnhub" style={{color:"var(--fg-4)"}} />
        </div>
      </div>
      {err && <div className="addform-err">{err}</div>}
      <div className="addform-foot">
        <span style={{color:"var(--fg-4)", fontSize:9.5}}>Type ticker → auto-fills name, sector, industry, beta · ↵ to add · Esc to cancel</span>
        <span style={{flex:1}}></span>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary">Add Position</button>
      </div>
    </form>
  );
}

// ─────────── Sparkline (deterministic) ───────────
function Sparkline({ ticker, dayP }) {
  const seed = ticker.split("").reduce((a,c) => a + c.charCodeAt(0), 0);
  const bars = Array.from({length: 18}, (_, i) => Math.sin((seed + i*1.7) * 0.7) * 0.5 + Math.cos((seed*0.3 + i)*1.1) * 0.3);
  return (
    <span className="spark" aria-hidden>
      {bars.map((v, i) => {
        const h = Math.max(2, 4 + v * 7);
        const cls = i === bars.length - 1 ? (dayP >= 0 ? "up" : "dn") : "";
        return <span key={i} className={"b " + cls} style={{height: h + "px"}}></span>;
      })}
    </span>
  );
}

// ─────────── Inventory table ───────────
const COLS = [
  { id: "ticker", label: "Ticker",     w: 180, align: "left" },
  { id: "broker", label: "Broker",     w: 80  },
  { id: "qty",    label: "Qty",        w: 60  },
  { id: "avg",    label: "Avg Cost",   w: 80  },
  { id: "px",     label: "Last",       w: 80  },
  { id: "dayP",   label: "Day %",      w: 65  },
  { id: "eq",     label: "Mkt Value",  w: 100 },
  { id: "uplP",   label: "Unr P/L %",  w: 80  },
  { id: "weight", label: "Sector Wt",  w: 120 },
  { id: "beta",   label: "β",          w: 50  },
];

// ─────────── Inline edit row ───────────
function EditRow({ row, onSave, onCancel }) {
  const [qty, setQty] = useState(String(row.qty));
  const [avg, setAvg] = useState(String(row.avg));
  const qtyRef = useRef(null);
  useEffect(() => { qtyRef.current?.select(); }, []);

  const save = () => {
    const q = +qty, a = +avg;
    if (!q || q <= 0 || !a || a <= 0) return;
    onSave(row.ticker, row.broker, { qty: q, avg: a });
  };

  return (
    <tr className="edit-row">
      <td>
        <span className="tkr">
          <span className="glyph">{row.ticker.slice(0,2)}</span>
          {row.ticker}
        </span>
        <span style={{fontFamily:"var(--mono)", fontSize:10, color:"var(--acc)", marginLeft:8}}>EDITING</span>
      </td>
      <td><span className={"broker-tag " + (row.broker === "Tiger" ? "tiger" : row.broker === "IBKR" ? "ibkr" : "custom")}>{row.broker.toUpperCase()}</span></td>
      <td>
        <input className="edit-input" ref={qtyRef} type="number" step="any" value={qty}
               onChange={(e) => setQty(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }} />
      </td>
      <td>
        <input className="edit-input" type="number" step="any" value={avg}
               onChange={(e) => setAvg(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onCancel(); }} />
      </td>
      <td colSpan={4} style={{textAlign:"left", paddingLeft:12}}>
        <button className="btn-mini" onClick={save} style={{marginRight:6}}>✓ SAVE</button>
        <button className="btn-mini ghost" onClick={onCancel}>ESC</button>
        <span style={{fontFamily:"var(--mono)", fontSize:9, color:"var(--fg-4)", marginLeft:10}}>↵ save · Esc cancel</span>
      </td>
      <td colSpan={3}></td>
    </tr>
  );
}

function InventoryTable({ onHover, onLeave, onSelect, selected }) {
  const { rows, totalEq, totalCost, totalUplP, dayPLP, portBeta, removePosition, updatePosition } = useContext(PortfolioCtx);
  const [sortKey, setSortKey] = useState("eq");
  const [sortDir, setSortDir] = useState("desc");
  const [editing, setEditing] = useState(null); // "TICKER·BROKER" key

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortKey === "weight" ? a.eq : a[sortKey];
      const bv = sortKey === "weight" ? b.eq : b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av||0) - (bv||0) : (bv||0) - (av||0);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const onSort = (id) => {
    if (id === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(id); setSortDir("desc"); }
  };
  const arr = (id) => sortKey === id ? <span className="arr">{sortDir === "asc" ? "▲" : "▼"}</span> : null;

  const handleSave = (ticker, broker, updates) => {
    updatePosition(ticker, broker, updates);
    setEditing(null);
  };

  return (
    <table className="tbl">
      <thead>
        <tr>
          {COLS.map(c => (
            <th key={c.id} style={{width: c.w, textAlign: c.align || "right"}} onClick={() => onSort(c.id)}>
              {c.label}{arr(c.id)}
            </th>
          ))}
          <th style={{width: 46}}></th>
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 && (
          <tr><td colSpan={11}><div className="no-data">No positions. Click <b style={{color:"var(--fg-1)"}}>+ ADD</b> in the header to get started.</div></td></tr>
        )}
        {sorted.map(r => {
          const rowKey = r.ticker + "·" + r.broker;
          if (editing === rowKey) {
            return <EditRow key={rowKey} row={r} onSave={handleSave} onCancel={() => setEditing(null)} />;
          }
          const w = totalEq > 0 ? (r.eq / totalEq) * 100 : 0;
          const tagClass = r.broker === "Tiger" ? "tiger" : r.broker === "IBKR" ? "ibkr" : "custom";
          return (
            <tr key={rowKey}
                className={selected === r.ticker ? "sel" : ""}
                onMouseEnter={(e) => onHover(r.ticker, e.currentTarget)}
                onMouseLeave={onLeave}
                onClick={() => onSelect(r.ticker)}
                onDoubleClick={() => setEditing(rowKey)}>
              <td>
                <span className="tkr">
                  <span className="glyph">{r.ticker.slice(0,2)}</span>
                  {r.ticker}
                </span>
                <Sparkline ticker={r.ticker} dayP={r.dayP} />
                <div style={{fontFamily:"var(--sans)", fontSize:10, color:"var(--fg-3)", marginTop:2, marginLeft:26}}>
                  {r.name} · <span style={{color:"var(--fg-4)"}}>{r.industry || r.sector}</span>
                </div>
              </td>
              <td><span className={"broker-tag " + tagClass}>{r.broker.toUpperCase()}</span></td>
              <td>{r.qty.toLocaleString()}</td>
              <td>{fmtMoney(r.avg)}</td>
              <td style={{color:"var(--fg-0)"}}>{fmtMoney(r.px)}</td>
              <td className={r.dayP >= 0 ? "pl-pos" : "pl-neg"}>{fmtPct(r.dayP)}</td>
              <td style={{color:"var(--fg-0)"}}>${fmtCompact(r.eq)}</td>
              <td className={r.uplP >= 0 ? "pl-pos" : "pl-neg"}>{fmtPct(r.uplP, 1)}</td>
              <td>
                <span className={"wbar " + (w > 20 ? "lg" : "")}>
                  <span className="bar"><span className="fill" style={{width: Math.min(100, w*2.2) + "%"}}></span></span>
                  <span style={{minWidth: 38, textAlign: "right"}}>{w.toFixed(1)}%</span>
                </span>
              </td>
              <td className="fg-2">{(r.beta || 0).toFixed(2)}</td>
              <td className="row-actions">
                <button className="e-btn" title="Edit position"
                        onClick={(e) => { e.stopPropagation(); setEditing(rowKey); }}>
                  ✎
                </button>
                <button className="x-btn" title="Remove position"
                        onClick={(e) => { e.stopPropagation(); removePosition(r.ticker, r.broker); }}>
                  ×
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
      {sorted.length > 0 && (
        <tfoot>
          <tr>
            <td><span style={{fontFamily:"var(--mono)", color:"var(--fg-2)", fontSize:9.5, letterSpacing:"0.1em"}}>CONSOLIDATED · {sorted.length} POS</span></td>
            <td colSpan={2} className="fg-3" style={{textAlign:"right"}}>—</td>
            <td className="fg-3">—</td>
            <td className="fg-3">—</td>
            <td className={dayPLP >= 0 ? "pl-pos" : "pl-neg"}>{fmtPct(dayPLP)}</td>
            <td style={{color:"var(--fg-0)"}}>${fmtCompact(totalEq)}</td>
            <td className={totalUplP >= 0 ? "pl-pos" : "pl-neg"}>{fmtPct(totalUplP, 1)}</td>
            <td className="fg-3">100.0%</td>
            <td className="fg-2">{portBeta.toFixed(2)}</td>
            <td></td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// ─────────── Treemap (squarified-lite) ───────────
function squarify(items, x, y, w, h) {
  const result = [];
  function layout(arr, x, y, w, h) {
    if (!arr.length) return;
    if (arr.length === 1) { result.push({ ...arr[0], x, y, w, h }); return; }
    const tot = arr.reduce((s,i) => s+i.value, 0);
    const horizontal = w >= h;
    let acc = 0; let cut = 0;
    for (let i = 0; i < arr.length; i++) {
      acc += arr[i].value; cut = i + 1;
      if (acc >= tot / 2) break;
    }
    const head = arr.slice(0, cut);
    const tail = arr.slice(cut);
    const headTot = head.reduce((s,i)=>s+i.value, 0);
    const ratio = headTot / tot;
    if (horizontal) {
      const hw = w * ratio; let hy = y;
      head.forEach(it => { const ih = h * (it.value / headTot); result.push({ ...it, x, y: hy, w: hw, h: ih }); hy += ih; });
      layout(tail, x + hw, y, w - hw, h);
    } else {
      const hh = h * ratio; let hx = x;
      head.forEach(it => { const iw = w * (it.value / headTot); result.push({ ...it, x: hx, y, w: iw, h: hh }); hx += iw; });
      layout(tail, x, y + hh, w, h - hh);
    }
  }
  layout(items, x, y, w, h);
  return result;
}

function Treemap({ onHover, onLeave, mode }) {
  const { rows, sectorBreakdown } = useContext(PortfolioCtx);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 360 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(200, r.width), h: Math.max(160, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const items = rows
    .filter(r => r.sector !== "Cash" && r.eq > 0)
    .map(r => ({ ticker: r.ticker, value: r.eq, dayP: r.dayP, eq: r.eq, broker: r.broker, sector: r.sector, industry: r.industry }))
    .sort((a, b) => b.value - a.value);

  const cells = items.length ? squarify(items, 0, 0, size.w, size.h) : [];

  return (
    <div className="tree-wrap">
      <div ref={wrapRef} style={{position:"relative", minHeight:0, flex:1}}>
        {cells.length === 0 && <div className="no-data">No holdings to chart.</div>}
        <svg className="tree-svg" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          {cells.map(c => {
            const fill = mode === "sector"
              ? (SECTOR_COLORS[c.sector] || "#71717a") + "66"
              : heatColor(c.dayP);
            const showFull = c.w > 70 && c.h > 50;
            const showMini = c.w > 36 && c.h > 22;
            const px = c.x + 8, py = c.y + 16;
            return (
              <g key={c.ticker + c.broker}
                 onMouseEnter={(e) => onHover(c.ticker, e.currentTarget)}
                 onMouseLeave={onLeave}>
                <rect className="cell" x={c.x} y={c.y} width={c.w} height={c.h} fill={fill} />
                {showFull && (
                  <>
                    <text className="lbl-tkr" x={px} y={py} fontSize={Math.min(22, c.w/4.5, c.h/3)}>{c.ticker}</text>
                    <text className="lbl-px"  x={px} y={py + Math.min(20, c.h/3.4)} fontSize={Math.min(13, c.w/8)}>{fmtPct(c.dayP)}</text>
                    <text className="lbl-meta" x={px} y={c.y + c.h - 18} fontSize={10}>${fmtCompact(c.eq)}</text>
                    <text className="lbl-meta" x={px} y={c.y + c.h - 6} fontSize={9.5}>{c.broker.toUpperCase()} · {c.industry || c.sector}</text>
                  </>
                )}
                {!showFull && showMini && (
                  <>
                    <text className="lbl-tkr" x={px} y={py} fontSize={12}>{c.ticker}</text>
                    <text className="lbl-px"  x={px} y={py + 13} fontSize={10}>{fmtPct(c.dayP)}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="tree-legend">
        <span>HEATMAP · Size = Mkt Value · Color = {mode === "sector" ? "Sector" : "Day Δ"}</span>
        <span style={{flex:1}}></span>
        {mode === "sector" ? (
          sectorBreakdown.filter(s => s.sector !== "Cash").map(s => (
            <span key={s.sector} className="label">
              <span className="sw" style={{background: (SECTOR_COLORS[s.sector] || "#71717a") + "99", width: 10, height: 10}}></span>
              {s.sector} {s.pct.toFixed(0)}%
            </span>
          ))
        ) : (
          <>
            <span className="label">−5%</span>
            <span className="scale">
              {[-5,-4,-3,-2,-1,0,1,2,3,4,5].map(v => (
                <span key={v} className="sw" style={{background: heatColor(v)}}></span>
              ))}
            </span>
            <span className="label">+5%</span>
            <span style={{marginLeft:14, color:"var(--fg-4)"}}>{items.length} HOLDINGS · ${fmtCompact(items.reduce((s,i)=>s+i.eq,0))}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────── Intelligence Feed (Synthesis + News) ───────────
function IntelFeed({ liveNews }) {
  const { rows } = useContext(PortfolioCtx);
  const tickers = new Set(rows.map(r => r.ticker));
  const filteredSeedNews = NEWS_SEED.filter(n => tickers.has(n.ticker));
  const [tab, setTab] = useState("synthesis");
  const [synthesis, setSynthesis] = useState(null);
  const [synthLoading, setSynthLoading] = useState(true);
  const [synthCached, setSynthCached] = useState(false);

  // Fetch live Gemini synthesis from backend
  useEffect(() => {
    const tickerList = Array.from(tickers).filter(t => t !== "USD").join(",");
    if (!tickerList) { setSynthLoading(false); return; }
    setSynthLoading(true);
    fetch(`/api/synthesis?tickers=${tickerList}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.catalysts) {
          setSynthesis(data);
          setSynthCached(!!data.cached);
        }
      })
      .catch(() => {})
      .finally(() => setSynthLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Use live synthesis if available, fall back to seed
  const synth = synthesis || SYNTHESIS;

  // Merge live news with seed news, preferring live
  const newsItems = liveNews.length > 0 ? liveNews : filteredSeedNews;

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>03</span><span className="num">·</span>
        INTELLIGENCE FEED
        <div className="right">
          <span className={"tab " + (tab === "synthesis" ? "on" : "")} onClick={() => setTab("synthesis")}>Synthesis</span>
          <span className={"tab " + (tab === "news" ? "on" : "")} onClick={() => setTab("news")}>News · {newsItems.length}</span>
          <span className="src">{liveNews.length > 0 ? "FINNHUB · LIVE" : "FINNHUB · SEED"}</span>
        </div>
      </div>
      <div className="pane-body intel">
        {tab === "synthesis" ? (
          <>
            {synthLoading && <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--fg-3)",padding:"8px 0"}}>Fetching live synthesis…</div>}
            <div className="intel-section">
              <h4><span className="dot cat"></span>CATALYSTS<span className="chip gem">{synthesis ? (synthCached ? "GEMINI · CACHED" : "GEMINI · LIVE") : "GEMINI · SEED"}</span></h4>
              <div className="bullets">
                {synth.catalysts.map((b, i) => (
                  <div className="bullet" key={i}><span className="ix">C.{i+1}</span><span>{b}</span></div>
                ))}
              </div>
            </div>
            <div className="intel-section">
              <h4><span className="dot rsk"></span>RISKS<span className="chip gem">{synthesis ? (synthCached ? "GEMINI · CACHED" : "GEMINI · LIVE") : "GEMINI · SEED"}</span></h4>
              <div className="bullets">
                {synth.risks.map((b, i) => (
                  <div className="bullet" key={i}><span className="ix">R.{i+1}</span><span>{b}</span></div>
                ))}
              </div>
            </div>
            <div className="intel-section">
              <h4><span className="dot mac"></span>MACRO ALIGNMENT<span className="chip gem">{synthesis ? (synthCached ? "GEMINI · CACHED" : "GEMINI · LIVE") : "GEMINI · SEED"}</span></h4>
              <div className="bullets">
                {synth.macro.map((b, i) => (
                  <div className="bullet" key={i}><span className="ix">M.{i+1}</span><span>{b}</span></div>
                ))}
              </div>
            </div>
            <div className="intel-section" style={{borderBottom:"none"}}>
              <h4>SOURCE WINDOW<span className="chip">FINNHUB · 24H</span></h4>
              <div style={{fontFamily:"var(--mono)", fontSize:10, color:"var(--fg-3)", lineHeight:1.7}}>
                Synthesized from <span style={{color:"var(--fg-1)"}}>{newsItems.length} headlines</span> matching your book.
                Tickers in window: <span style={{color:"var(--fg-1)"}}>{Array.from(tickers).filter(t => t !== "USD").join(" · ") || "—"}</span>.
              </div>
            </div>
          </>
        ) : (
          <div className="news">
            {newsItems.length === 0 && <div className="no-data">No headlines match your positions.</div>}
            {newsItems.map((n, i) => {
              const dateStr = n.datetime ? new Date(n.datetime * 1000).toISOString() : "";
              return (
                <div key={i} className="news-item">
                  <div className="meta">
                    <span className="src">{n.source || n.src || n.site || "—"}</span>
                    <span className="ago">{dateStr ? timeAgo(dateStr) + " ago" : (n.ago ? n.ago + " ago" : "—")}</span>
                  </div>
                  <div className="ttl">{(n.headline || n.title || "").slice(0, 120)}</div>
                  <span className="tk">{n.ticker || n.related || n.symbol || "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── News Wire (live via /api/wire, falls back to WIRE_SEED) ───────────
function NewsWire({ tickers = [] }) {
  const [items, setItems] = useState(WIRE_SEED);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const tickerList = tickers.filter(t => t !== "USD").join(",");
    const url = tickerList ? `/api/wire?tickers=${tickerList}` : "/api/wire";
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setItems(data);
          setLive(true);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = items.filter(n => {
    if (filter === "all") return true;
    if (filter === "tickers") return n.tag === "TICKER" || n.tag === "SECTOR";
    if (filter === "macro") return n.tag === "MACRO" || n.tag === "SECTOR";
    return true;
  });

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>03b</span><span className="num">·</span>
        NEWS WIRE
        <span className="chip-syn">SYNTHESIZED</span>
        <div className="right">
          <span className={"tab " + (filter === "all"     ? "on" : "")} onClick={() => setFilter("all")}>All</span>
          <span className={"tab " + (filter === "tickers" ? "on" : "")} onClick={() => setFilter("tickers")}>Tickers</span>
          <span className={"tab " + (filter === "macro"   ? "on" : "")} onClick={() => setFilter("macro")}>Macro</span>
          <span className="src">{live ? "FINNHUB · TAVILY" : "SEED DATA"}</span>
        </div>
      </div>
      <div className="pane-body wire">
        {filtered.length === 0 && (
          <div className="no-data">No items in selected filter.</div>
        )}
        {filtered.map((n, i) => (
          <div key={i} className={"wire-item sev-" + (n.severity || "info")}>
            <div className="wire-meta">
              <span className={"wire-tag tag-" + (n.tag || "TICKER").toLowerCase()}>
                {n.tag === "MACRO" ? "◆ MACRO" : n.tag === "SECTOR" ? "▤ " + (n.ticker_or_sector || "SECTOR") : n.ticker_or_sector}
              </span>
              <span className="wire-src">{n.source}</span>
              <span className="wire-ago">{n.ago} ago</span>
            </div>
            <div className="wire-headline">{n.headline}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────── Macro chart (with overlay toggle) ───────────
function MacroChart() {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 200 });
  const [overlay, setOverlay] = useState("spread");

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(300, r.width), h: Math.max(120, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const { portfolio, spx, spread, labels } = MACRO_SERIES;
  const padL = 38, padR = 38, padT = 16, padB = 22;
  const W = size.w - padL - padR;
  const H = size.h - padT - padB;
  const leftSeries = overlay === "spx" ? [...portfolio, ...spx] : portfolio;
  const lMin = Math.min(...leftSeries) - 4;
  const lMax = Math.max(...leftSeries) + 4;
  const rightArr = overlay === "spread" ? spread : spx;
  const rMin = Math.min(...rightArr) - (overlay === "spread" ? 6 : 4);
  const rMax = Math.max(...rightArr) + (overlay === "spread" ? 6 : 4);

  const xAt = (i) => padL + (i / (labels.length - 1)) * W;
  const yL  = (v) => padT + H - ((v - lMin) / (lMax - lMin)) * H;
  const yR  = (v) => padT + H - ((v - rMin) / (rMax - rMin)) * H;
  const pathFn = (arr, fn) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${fn(v).toFixed(2)}`).join(" ");
  const areaFn = (arr) => `${pathFn(arr, yL)} L ${xAt(arr.length-1)} ${padT+H} L ${xAt(0)} ${padT+H} Z`;

  const gridL = []; for (let i = 0; i <= 4; i++) { const v = lMin + (i / 4) * (lMax - lMin); gridL.push({ v, y: yL(v) }); }
  const ticksR = []; for (let i = 0; i <= 4; i++) { const v = rMin + (i / 4) * (rMax - rMin); ticksR.push({ v, y: yR(v) }); }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>04</span><span className="num">·</span>
        MACRO CORRELATION
        <div className="right">
          <span className={"tab " + (overlay === "spread" ? "on" : "")} onClick={() => setOverlay("spread")}>10Y–2Y</span>
          <span className={"tab " + (overlay === "spx" ? "on" : "")} onClick={() => setOverlay("spx")}>SPX</span>
          <span className="src">SYNTHETIC</span>
        </div>
      </div>
      <div className="pane-body" style={{display:"flex", flexDirection:"column"}}>
        <div className="macro-wrap">
          <div className="macro-axis-row">
            <div className="legend">
              <span className="it"><span className="sw" style={{background:"var(--fg-0)"}}></span>Portfolio NAV (idx)</span>
              {overlay === "spx" && <span className="it"><span className="sw" style={{background:"var(--info)"}}></span>S&amp;P 500 (idx)</span>}
              {overlay === "spread" && <span className="it"><span className="sw" style={{background:"var(--warn)"}}></span>10Y–2Y Spread (bps)</span>}
            </div>
            <div>
              {overlay === "spread"
                ? <>Curve <span style={{color:"var(--fg-1)"}}>+38 bps</span> · steepening · ρ(NAV,Δspread) <span style={{color:"var(--fg-1)"}}>+0.71</span></>
                : <>SPX YTD <span style={{color:"var(--pos)"}}>+25.4%</span> · NAV YTD <span style={{color:"var(--pos)"}}>+46.2%</span> · ρ <span style={{color:"var(--fg-1)"}}>+0.89</span></>}
            </div>
          </div>
          <div ref={wrapRef} style={{flex:1, minHeight:0}}>
            <svg className="macro-svg" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
              {gridL.map((g, i) => (
                <g key={i}>
                  <line className="grid" x1={padL} x2={size.w - padR} y1={g.y} y2={g.y} />
                  <text className="axt" x={padL - 6} y={g.y + 3} textAnchor="end">{g.v.toFixed(0)}</text>
                </g>
              ))}
              {labels.map((l, i) => (
                <text key={i} className="axt" x={xAt(i)} y={padT + H + 14} textAnchor="middle"
                      style={{opacity: i % 2 === 0 ? 1 : 0.5}}>{l}</text>
              ))}
              {ticksR.map((t, i) => (
                <text key={i} className="axt" x={size.w - padR + 6} y={t.y + 3}>
                  {overlay === "spread" ? (t.v >= 0 ? "+" : "") + t.v.toFixed(0) + "bp" : t.v.toFixed(0)}
                </text>
              ))}
              <path d={areaFn(portfolio)} fill="rgba(244,244,245,0.06)" />
              <path d={pathFn(portfolio, yL)} fill="none" stroke="var(--fg-0)" strokeWidth="1.5" />
              {overlay === "spx" && <path d={pathFn(spx, yL)} fill="none" stroke="var(--info)" strokeWidth="1.25" strokeDasharray="3 3" />}
              {overlay === "spread" && <path d={pathFn(spread, yR)} fill="none" stroke="var(--warn)" strokeWidth="1.25" />}
              <line className="ax" x1={padL} x2={padL} y1={padT} y2={padT + H} />
              <line className="ax" x1={size.w-padR} x2={size.w-padR} y1={padT} y2={padT + H} />
              <line className="ax" x1={padL} x2={size.w-padR} y1={padT+H} y2={padT+H} />
              <line x1={xAt(labels.length-1)} x2={xAt(labels.length-1)} y1={padT} y2={padT+H} stroke="var(--line-strong)" strokeDasharray="2 2" />
              <circle cx={xAt(labels.length-1)} cy={yL(portfolio[portfolio.length-1])} r="3" fill="var(--fg-0)" />
              <text className="axt" x={xAt(labels.length-1) - 4} y={padT + 10} textAnchor="end" style={{fill:"var(--fg-2)"}}>NOW {portfolio[portfolio.length-1].toFixed(1)}</text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────── SEC tracker (with TL;DR) ───────────
function SecTracker({ liveFilings }) {
  const { rows } = useContext(PortfolioCtx);
  const tickers = new Set(rows.map(r => r.ticker));

  const MEANINGFUL_FORMS = new Set(["10-Q", "10-K", "8-K", "10-Q/A", "10-K/A", "6-K", "20-F"]);
  const seedFilings = SEC_SEED.filter(f => tickers.has(f.ticker));

  // Filter live filings to meaningful forms only, then merge with seed:
  // seed entries (which have Gemini TL;DRs) take priority per ticker;
  // live filings fill in tickers not covered by seed.
  const seedTickers = new Set(seedFilings.map(f => f.ticker));
  const filteredLive = liveFilings.filter(f => {
    const form = (f.form || f.type || "").toUpperCase().replace(/\s/g, "");
    return MEANINGFUL_FORMS.has(form) && !seedTickers.has(f.ticker);
  });
  const filings = [...seedFilings, ...filteredLive]
    .sort((a, b) => new Date(b.date || b.filedDate || 0) - new Date(a.date || a.filedDate || 0))
    .slice(0, 8);

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>05</span><span className="num">·</span>
        SEC INSIGHT TRACKER
        <div className="right">
          <span className="tab on">All Forms</span>
          <span className="tab">10-Q</span>
          <span className="tab">10-K</span>
          <span className="tab">8-K</span>
          <span className="src">EDGAR · GEMINI</span>
        </div>
      </div>
      <div className="pane-body sec">
        <div className="sec-hdr">
          <span>FORM</span><span>TKR</span><span>FILED</span><span>GEMINI TL;DR</span>
          <span style={{textAlign:"right"}}>ACCESSION</span>
        </div>
        {filings.length === 0 && <div className="no-data">No EDGAR filings match your tickers.</div>}
        {filings.map((f, i) => {
          const formType = (f.form || f.type || "").toUpperCase();
          const cls = formType.includes("10-Q") ? "q" : formType.includes("10-K") ? "k" : "f";
          const dateStr = f.date || f.filedDate || f.acceptedDate || "";
          const accession = f.url ? f.url.split("/")[1] : (f.reportUrl || "—");
          const tldr = f.tldr || (f.title || f.description || formType || "Filing").slice(0, 80);
          return (
            <div key={i} className="sec-row">
              <span className={"form " + cls}>{formType.slice(0, 6) || "FILING"}</span>
              <span style={{color:"var(--fg-0)", fontWeight:600}}>{f.ticker || f.symbol}</span>
              <span style={{color:"var(--fg-2)"}}>{dateStr.slice(0, 10)}</span>
              <span className="tldr">
                <span className="gem">◆ TL;DR</span>
                <span>{tldr}</span>
              </span>
              <span className="url">{typeof accession === "string" ? accession.slice(0, 20) : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── Insight popover (Finnhub) ───────────
function InsightPopover({ ticker, anchor, fundamentals }) {
  const { rows } = useContext(PortfolioCtx);
  if (!ticker || !anchor) return null;
  const r = rows.find(x => x.ticker === ticker);
  if (!r) return null;
  const f = fundamentals[ticker];

  const rect = anchor.getBoundingClientRect();
  const W = 320, H = 360;
  let left = rect.right + 12;
  let top = rect.top;
  if (left + W > window.innerWidth - 8) left = rect.left - W - 12;
  if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8;
  if (top < 8) top = 8;

  if (!f) {
    return (
      <div className="popover" style={{ left, top, width: W }}>
        <div className="pop-hdr">
          <span className="tk">{ticker}</span>
          <span className="nm">{r.name}</span>
          <span className="src">FINNHUB</span>
        </div>
        <div style={{padding: "16px 14px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-2)", lineHeight: 1.6}}>
          Loading fundamentals...
        </div>
        <div className="pop-grid" style={{borderTop: "1px solid var(--line)"}}>
          <div className="cell"><div className="k">Avg Cost</div><div className="v">${fmtMoney(r.avg)}</div></div>
          <div className="cell"><div className="k">Last Price</div><div className="v">${fmtMoney(r.px)}</div></div>
          <div className="cell"><div className="k">Mkt Value</div><div className="v">${fmtCompact(r.eq)}</div></div>
          <div className="cell"><div className="k">Unrealized</div><div className={"v " + (r.uplP>=0?"pos":"neg")}>{fmtPct(r.uplP, 1)}</div></div>
        </div>
      </div>
    );
  }

  const fmtVal = (v, suffix = "") => v != null ? v.toFixed(1) + suffix : "n/a";
  const mcapStr = f.marketCap ? (f.marketCap >= 1e6 ? (f.marketCap / 1e6).toFixed(0) + "T" : f.marketCap >= 1e3 ? (f.marketCap / 1e3).toFixed(0) + "B" : f.marketCap.toFixed(0) + "M") : "—";

  return (
    <div className="popover" style={{ left, top }}>
      <div className="pop-hdr">
        <span className="tk">{ticker}</span>
        <span className="nm">{r.name}</span>
        <span className="src">FINNHUB</span>
      </div>
      <div className="pop-grid">
        <div className="cell"><div className="k">P/E (TTM)</div><div className="v">{f.pe != null ? f.pe.toFixed(1) : "n/m"}</div></div>
        <div className="cell"><div className="k">P/FCF</div><div className="v">{f.pfcf != null ? f.pfcf.toFixed(1) : "n/m"}</div></div>
        <div className="cell"><div className="k">Debt / Equity</div><div className="v">{f.de != null ? f.de.toFixed(2) : "—"}<small>x</small></div></div>
        <div className="cell"><div className="k">Gross Margin</div><div className="v">{f.gm != null ? (f.gm * 100).toFixed(1) : "—"}<small>%</small></div></div>
        <div className="cell"><div className="k">ROIC</div><div className="v">{f.roic != null ? (f.roic * 100).toFixed(1) : "—"}<small>%</small></div></div>
        <div className="cell"><div className="k">Mkt Cap</div><div className="v">{mcapStr}</div></div>
        <div className="cell"><div className="k">52W High</div><div className="v">{f.high52 != null ? "$" + fmtMoney(f.high52) : "—"}</div></div>
        <div className="cell"><div className="k">52W Low</div><div className="v">{f.low52 != null ? "$" + fmtMoney(f.low52) : "—"}</div></div>
        <div className="cell"><div className="k">Div Yield</div><div className="v">{f.divYield != null ? f.divYield.toFixed(2) : "0.00"}<small>%</small></div></div>
        <div className="cell"><div className="k">Beta</div><div className="v">{(r.beta || 0).toFixed(2)}</div></div>
      </div>
      <div className="pop-foot">
        <span>FINNHUB · /stock/metric/{ticker}</span>
        <span style={{color: "var(--fg-2)"}}>
          {r.uplP >= 0 ? "▲" : "▼"} {fmtPct(r.uplP, 1)} vs cost
        </span>
      </div>
    </div>
  );
}

// ─────────── Status bar ───────────
function StatusBar({ hovered }) {
  const { rows, brokers } = useContext(PortfolioCtx);
  return (
    <div className="status">
      <span className="item"><span style={{color:"var(--pos)"}}>●</span> CONNECTED</span>
      <span className="item">MODE <b>READ-ONLY</b></span>
      <span className="item">SOURCE <b>MANUAL+LIVE</b></span>
      <span className="item">POSITIONS <b>{rows.length}</b></span>
      <span className="item">BROKERS <b>{brokers.length}</b></span>
      <span className="item">FX BASE <b>USD</b></span>
      <span className="spacer"></span>
      <span className="item">FOCUS <b>{hovered || "—"}</b></span>
      <span className="item" style={{color:"var(--fg-4)"}}>NO ORDER ENTRY · ANALYSIS ONLY</span>
    </div>
  );
}

// ─────────── DD helpers ───────────
const DD_GRADE_COLOR = {
  "STRONG BUY":  "var(--pos)",
  "BUY":         "#86efac",
  "HOLD":        "var(--warn)",
  "SELL":        "var(--neg)",
  "STRONG SELL": "#dc2626",
};
const DD_AGENTS = ["ValueHunter","GrowthAlpha","QuantSignal","RiskSentinel","MacroLens"];

function DDScoreBar({ score, width = 18 }) {
  const filled = Math.round((score / 10) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return (
    <span style={{fontFamily:"var(--mono)", fontSize:10, letterSpacing:-0.5}}>
      {bar} <span style={{color:"var(--fg-2)"}}>{score.toFixed(1)}</span>
    </span>
  );
}

function DDGradeBadge({ grade, score }) {
  const color = DD_GRADE_COLOR[grade] || "var(--fg-2)";
  return (
    <span style={{
      fontFamily:"var(--mono)", fontWeight:700, fontSize:10.5,
      color, letterSpacing:"0.04em",
      border:`1px solid ${color}`, padding:"1px 7px",
      background:`${color}18`,
    }}>
      {grade}
    </span>
  );
}

// ─────────── Sovereign DD Panel ───────────
function DDPanel({ ticker, ddData, ddLoading, ddPolling, ddIndex, onTrigger, onFetch }) {
  const [input, setInput] = useState(ticker || "");
  const grade  = ddData?.result?.consensus_grade;
  const score  = ddData?.result?.consensus_score;
  const result = ddData?.result;

  // Sync input field with selected ticker
  useEffect(() => { if (ticker) setInput(ticker); }, [ticker]);

  const submit = (e) => {
    e?.preventDefault();
    const t = input.trim().toUpperCase();
    if (!t) return;
    onFetch(t);
  };

  const trigger = (e) => {
    e?.preventDefault();
    const t = input.trim().toUpperCase();
    if (!t) return;
    onTrigger(t);
  };

  const indexEntry = ddIndex && input ? ddIndex[input.toUpperCase()] : null;

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>DD</span><span className="num">·</span>
        SOVEREIGN DD
        <div className="right">
          {ddIndex && Object.keys(ddIndex).length > 0 && (
            <span className="src">{Object.keys(ddIndex).length} CACHED</span>
          )}
          <span className="src">GEMMA 4 31B</span>
        </div>
      </div>

      {/* Ticker bar */}
      <form className="dd-bar" onSubmit={submit}>
        <input
          className="dd-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Ticker…"
          maxLength={8}
        />
        <button type="submit" className="btn-mini" disabled={ddLoading || ddPolling}>
          {ddLoading ? "…" : "Load"}
        </button>
        <button type="button" className="btn-mini ghost" onClick={trigger} disabled={ddLoading || ddPolling} title="Run full multi-agent analysis (~5 min)">
          {ddPolling ? "Running…" : "Analyze"}
        </button>
        {indexEntry && (
          <span style={{fontFamily:"var(--mono)", fontSize:9.5, color: DD_GRADE_COLOR[indexEntry.grade] || "var(--fg-3)", marginLeft:6}}>
            {indexEntry.grade} {indexEntry.score?.toFixed(1)}
            {indexEntry.updated ? <span style={{color:"var(--fg-4)"}}> · {timeAgo(indexEntry.updated.replace("_"," ").slice(0,19)+"Z")} ago</span> : ""}
          </span>
        )}
      </form>

      <div className="pane-body dd-body">
        {ddPolling && (
          <div className="dd-status">
            <div className="loading-spinner" style={{width:14, height:14, border:"2px solid var(--line-strong)", borderTopColor:"var(--info)"}}></div>
            <span>Analysis dispatched — checks every 60s for results…</span>
          </div>
        )}

        {ddLoading && !ddPolling && (
          <div className="dd-status">
            <div className="loading-spinner" style={{width:14, height:14, border:"2px solid var(--line-strong)", borderTopColor:"var(--fg-1)"}}></div>
            <span>Loading analysis…</span>
          </div>
        )}

        {!ddLoading && !ddPolling && ddData?._error && (
          <div className="dd-status" style={{color:"var(--neg)"}}>
            <span>⚠ {ddData._error}</span>
          </div>
        )}

        {!ddLoading && !ddData && !ddPolling && (
          <div className="dd-empty">
            <div className="dd-empty-title">SOVEREIGN DD</div>
            <div className="dd-empty-sub">Click a position or enter a ticker to load analysis. Hit <b>Analyze</b> to run a fresh multi-agent debate (~5 min).</div>
          </div>
        )}

        {!ddLoading && result && (
          <>
            {/* Score hero */}
            <div className="dd-hero">
              <div className="dd-score" style={{color: DD_GRADE_COLOR[grade] || "var(--fg-1)"}}>
                {score?.toFixed(2)}
              </div>
              <div className="dd-hero-right">
                <DDGradeBadge grade={grade} score={score} />
                <span style={{fontFamily:"var(--mono)", fontSize:9.5, color:"var(--fg-3)", marginLeft:8}}>
                  {result.confidence} confidence
                </span>
                <div style={{marginTop:4}}>
                  <DDScoreBar score={score || 0} width={20} />
                </div>
                <div style={{fontSize:9.5, color:"var(--fg-4)", marginTop:3, fontFamily:"var(--mono)"}}>
                  {result.converged ? `Converged · ${result.loops_run} loop(s)` : `Moderator · ${result.loops_run} loop(s)`} · spread {result.score_spread?.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Agent table */}
            <div className="dd-agents">
              {DD_AGENTS.map(agent => {
                const s1 = result.agent_r1_scores?.[agent];
                const sf = result.agent_final_scores?.[agent];
                if (s1 == null) return null;
                const delta  = sf - s1;
                const arrow  = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
                const dColor = delta > 0 ? "var(--pos)" : delta < 0 ? "var(--neg)" : "var(--fg-4)";
                const gColor = DD_GRADE_COLOR[sf >= 8 ? "STRONG BUY" : sf >= 6.5 ? "BUY" : sf >= 5 ? "HOLD" : sf >= 3.5 ? "SELL" : "STRONG SELL"] || "var(--fg-2)";
                return (
                  <div key={agent} className="dd-agent-row">
                    <span className="dd-agent-name">{agent}</span>
                    <span style={{fontFamily:"var(--mono)", fontSize:10, color:"var(--fg-3)"}}>{s1.toFixed(1)}</span>
                    <span style={{fontFamily:"var(--mono)", fontSize:10, color:dColor, minWidth:32, textAlign:"right"}}>
                      {arrow}{Math.abs(delta).toFixed(1)}
                    </span>
                    <span style={{fontFamily:"var(--mono)", fontSize:10, color:gColor, fontWeight:700, minWidth:28}}>{sf.toFixed(1)}</span>
                    <DDScoreBar score={sf} width={10} />
                  </div>
                );
              })}
            </div>

            {/* Thesis */}
            {result.majority_thesis && (
              <div className="dd-section">
                <div className="dd-section-label">MAJORITY THESIS</div>
                <div className="dd-section-body">{result.majority_thesis.slice(0, 360)}</div>
              </div>
            )}
            {result.key_swing_factor && (
              <div className="dd-section">
                <div className="dd-section-label">KEY SWING FACTOR</div>
                <div className="dd-section-body" style={{color:"var(--warn)"}}>{result.key_swing_factor.slice(0, 200)}</div>
              </div>
            )}
            {result.dissent && (
              <div className="dd-section">
                <div className="dd-section-label">DISSENT</div>
                <div className="dd-section-body" style={{color:"var(--fg-3)"}}>{result.dissent.slice(0, 200)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────── Scout Feed (BUY signal discoveries) ───────────
function ScoutFeed({ scouts }) {
  if (!scouts || scouts.length === 0) {
    return (
      <div className="pane">
        <div className="pane-hdr">
          <span>SC</span><span className="num">·</span>
          SOVEREIGN SCOUT
          <div className="right"><span className="src">PRE-MARKET</span></div>
        </div>
        <div className="pane-body" style={{display:"flex", alignItems:"center", justifyContent:"center"}}>
          <div style={{textAlign:"center", color:"var(--fg-4)", fontFamily:"var(--mono)", fontSize:10, lineHeight:1.8}}>
            <div>SCOUT IS HUNTING</div>
            <div style={{marginTop:4, fontSize:9.5}}>BUY signals appear here pre-market</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>SC</span><span className="num">·</span>
        SOVEREIGN SCOUT
        <div className="right">
          <span className="src">{scouts.length} SIGNAL{scouts.length !== 1 ? "S" : ""}</span>
        </div>
      </div>
      <div className="pane-body scout-body">
        {scouts.map((d, i) => {
          const color = DD_GRADE_COLOR[d.grade] || "var(--fg-2)";
          return (
            <div key={i} className="scout-card" style={{borderLeft:`2px solid ${color}`}}>
              <div className="scout-card-hdr">
                <span className="scout-ticker">{d.ticker}</span>
                <DDGradeBadge grade={d.grade} score={d.score} />
                <span style={{fontFamily:"var(--mono)", fontSize:11, color, marginLeft:6, fontWeight:700}}>{d.score?.toFixed(1)}</span>
                {d.scout_lens && (
                  <span style={{fontFamily:"var(--mono)", fontSize:8.5, color:"var(--acc)",
                    border:"1px solid var(--acc)", padding:"1px 5px", opacity:0.75}}>
                    {d.scout_lens}
                  </span>
                )}
                <span style={{marginLeft:"auto", fontFamily:"var(--mono)", fontSize:9, color:"var(--fg-4)"}}>
                  {d.analyzed_at ? timeAgo(d.analyzed_at.replace("_"," ").slice(0,19)+"Z") + " ago" : ""}
                </span>
              </div>
              {d.thesis && (
                <div style={{fontSize:10.5, color:"var(--fg-2)", marginTop:4, lineHeight:1.5}}>
                  {d.thesis.slice(0, 160)}{d.thesis.length > 160 ? "…" : ""}
                </div>
              )}
              {d.key_swing && (
                <div style={{fontSize:9.5, color:"var(--warn)", marginTop:4, fontFamily:"var(--mono)"}}>
                  ↳ {d.key_swing.slice(0, 120)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── Root App ───────────
function App() {
  const [positions, setPositions] = useState(loadPositions);
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState({});
  const [liveNews, setLiveNews] = useState([]);
  const [liveFilings, setLiveFilings] = useState([]);
  const [fundamentals, setFundamentals] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const [dataStatus, setDataStatus] = useState({ quotes: false, news: false, sec: false });
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(positions[0]?.ticker || "");
  const [heatMode, setHeatMode] = useState("day");
  const [adding, setAdding] = useState(false);
  const [fxRate, setFxRate] = useState(null); // USD→SGD
  const [kvConnected, setKvConnected] = useState(false);

  // ── Sovereign DD state ──
  const [ddData, setDdData]       = useState(null);   // full analysis JSON
  const [ddLoading, setDdLoading] = useState(false);
  const [ddTicker, setDdTicker]   = useState("");
  const [ddPolling, setDdPolling] = useState(false);  // true while waiting for on-demand run
  const [ddIndex, setDdIndex]     = useState({});     // { TICKER: { score, grade, ... } }
  const [scouts, setScouts]       = useState([]);     // scout BUY discoveries
  const ddPollRef = useRef(null);

  // On mount: try loading fresher positions from KV (overrides localStorage seed)
  useEffect(() => {
    fetchPositionsFromKV().then(kvPositions => {
      if (kvPositions) {
        setPositions(kvPositions);
        setKvConnected(true);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(kvPositions)); } catch (e) {}
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist positions to localStorage + KV on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); } catch (e) {}
    savePositionsToKV(positions);
  }, [positions]);

  const tickers = useMemo(() => positions.map(p => p.ticker), [positions]);

  // Fetch live data from Finnhub
  const fetchAll = useCallback(async () => {
    const status = { quotes: false, news: false, sec: false };

    const q = await fetchQuotes(tickers);
    if (q) { setQuotes(q); status.quotes = true; }

    // Fetch USD→SGD exchange rate (free API, no key required)
    try {
      const fxRes = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=SGD");
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        if (fxData && fxData.rates && fxData.rates.SGD) setFxRate(fxData.rates.SGD);
      }
    } catch (e) { console.warn("FX rate fetch failed:", e.message); }

    const n = await fetchNews(tickers);
    if (n.length) { setLiveNews(n); status.news = true; }

    const f = await fetchSECFilings(tickers);
    if (f.length) { setLiveFilings(f); status.sec = true; }

    setDataStatus(status);
    setLastSync(Date.now());
    setLoading(false);
  }, [tickers]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, CONFIG.REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ── Sovereign DD: fetch analysis from KV via Pages Function ──
  const fetchDD = useCallback(async (ticker) => {
    if (!ticker || ticker === "USD") return;
    setDdLoading(true);
    setDdTicker(ticker);
    try {
      const res = await fetch(`/api/dd/${ticker}`);
      if (res.ok) {
        const data = await res.json();
        setDdData(data);
      } else {
        setDdData(null);
      }
    } catch {
      setDdData(null);
    }
    setDdLoading(false);
  }, []);

  // ── Sovereign DD: dispatch on-demand GitHub Actions workflow ──
  const triggerDD = useCallback(async (ticker) => {
    if (!ticker || ticker === "USD") return;
    setDdTicker(ticker);
    setDdPolling(true);
    setDdData(null);
    try {
      const res = await fetch("/api/dd/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.error || `HTTP ${res.status}`;
        setDdPolling(false);
        setDdData({ _error: `Dispatch failed: ${msg}` });
        return;
      }
    } catch (e) {
      setDdPolling(false);
      setDdData({ _error: `Dispatch error: ${e.message}` });
      return;
    }
    // Poll every 30s for the result (analysis takes ~5 min)
    if (ddPollRef.current) clearInterval(ddPollRef.current);
    ddPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/dd/${ticker}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.result?.ticker) {
            setDdData(data);
            setDdPolling(false);
            clearInterval(ddPollRef.current);
          }
        }
      } catch { /* keep polling */ }
    }, 30000);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => () => { if (ddPollRef.current) clearInterval(ddPollRef.current); }, []);

  // ── Load DD index + scouts on mount ──
  useEffect(() => {
    fetch("/api/dd/").then(r => r.ok ? r.json() : {}).then(d => setDdIndex(d || {})).catch(() => {});
    fetch("/api/dd/scouts").then(r => r.ok ? r.json() : []).then(d => setScouts(d || [])).catch(() => {});
  }, []);

  // ── Auto-fetch DD when selected ticker changes ──
  useEffect(() => {
    if (selected && selected !== "USD") fetchDD(selected);
  }, [selected, fetchDD]);

  // Fetch fundamentals (beta + metrics) for a ticker
  const fetchFundamentalsFor = useCallback(async (ticker) => {
    if (fundamentals[ticker] || ticker === "USD") return;
    const [metrics, profile] = await Promise.all([
      fetchBasicFinancials(ticker),
      fetchCompanyProfile(ticker),
    ]);
    const f = {};
    if (metrics) {
      f.pe = metrics.peNormalizedAnnual || metrics.peTTM;
      f.pfcf = metrics.pfcfShareTTM;
      f.de = metrics.totalDebtToEquityQuarterly;
      f.gm = metrics.grossMarginTTM;
      f.roic = metrics.roicTTM;
      f.divYield = metrics.dividendYieldIndicatedAnnual;
      f.high52 = metrics["52WeekHigh"];
      f.low52 = metrics["52WeekLow"];
      f.marketCap = metrics.marketCapitalization;
      f.beta = metrics.beta;
    }
    if (profile) {
      f.marketCap = f.marketCap || profile.marketCapitalization;
      f.industry = profile.finnhubIndustry;
    }
    setFundamentals(prev => ({ ...prev, [ticker]: f }));
  }, [fundamentals]);

  // Auto-fetch fundamentals (including beta) for all positions on load
  useEffect(() => {
    const fetchAllFundamentals = async () => {
      for (const t of tickers) {
        if (t !== "USD" && !fundamentals[t]) {
          await fetchFundamentalsFor(t);
          await delay(120);
        }
      }
    };
    fetchAllFundamentals();
  }, [tickers]); // only re-run when tickers change

  // Enrich positions with live quotes + auto-fetched beta
  const metrics = useMemo(() => {
    const rows = positions.map(p => {
      const q = quotes[p.ticker];
      const f = fundamentals[p.ticker];
      const px = q ? q.price : (p.ticker === "USD" ? p.avg : p.avg);
      const dayP = q ? (q.changePercent || 0) : 0;
      const beta = (f && f.beta != null) ? f.beta : (p.beta || 0);
      const eq = p.qty * px;
      const cost = p.qty * p.avg;
      const upl = eq - cost;
      const uplP = cost > 0 ? (upl / cost) * 100 : 0;
      return { ...p, px, dayP, beta, eq, cost, upl, uplP };
    });
    const totalEq   = rows.reduce((s,r) => s+r.eq, 0);
    const totalCost = rows.reduce((s,r) => s+r.cost, 0);
    const dayPL     = rows.reduce((s,r) => s+r.eq*(r.dayP/100), 0);
    const portBeta  = totalEq ? rows.reduce((s,r) => s+(r.eq/totalEq)*(r.beta||0), 0) : 0;
    const sectorMap = {};
    rows.forEach(r => { sectorMap[r.sector] = (sectorMap[r.sector] || 0) + r.eq; });
    const sectorBreakdown = Object.entries(sectorMap)
      .map(([k,v]) => ({ sector: k, eq: v, pct: totalEq ? (v/totalEq)*100 : 0 }))
      .sort((a,b) => b.eq - a.eq);
    const brokers = Array.from(new Set(rows.map(r => r.broker)));
    const brokerEq = {};
    brokers.forEach(b => { brokerEq[b] = rows.filter(r => r.broker === b).reduce((s,r) => s+r.eq, 0); });
    return {
      rows, totalEq, totalCost,
      totalUpl:  totalEq - totalCost,
      totalUplP: totalCost ? ((totalEq-totalCost)/totalCost)*100 : 0,
      dayPL, dayPLP: totalEq ? (dayPL/totalEq)*100 : 0,
      portBeta, sectorBreakdown, brokers, brokerEq,
    };
  }, [positions, quotes, fundamentals]);

  const addPosition = useCallback((p) => {
    setPositions(prev => [...prev, p]);
    setAdding(false);
  }, []);
  const removePosition = useCallback((ticker, broker) => {
    setPositions(prev => prev.filter(p => !(p.ticker === ticker && p.broker === broker)));
  }, []);
  const updatePosition = useCallback((ticker, broker, updates) => {
    setPositions(prev => prev.map(p =>
      (p.ticker === ticker && p.broker === broker) ? { ...p, ...updates } : p
    ));
  }, []);
  const resetSeed = () => {
    if (confirm("Reset positions to seed data? This cannot be undone.")) setPositions(SEED);
  };
  const clearAll = () => {
    if (confirm("Remove all positions?")) setPositions([]);
  };

  const ctxValue = { ...metrics, fxRate, addPosition, removePosition, updatePosition };

  const onHover = useCallback((ticker, anchor) => {
    setHover({ ticker, anchor });
    fetchFundamentalsFor(ticker);
  }, [fetchFundamentalsFor]);
  const onLeave = useCallback(() => setHover(null), []);

  if (loading) return <LoadingScreen />;

  return (
    <PortfolioCtx.Provider value={ctxValue}>
      <div className="app">
        <CommandBar />
        <SubBar dataStatus={dataStatus} lastSync={lastSync} kvConnected={kvConnected} />
        <div className="main">
          <div className="pane" style={{position:"relative"}}>
            <div className="pane-hdr">
              <span>01</span><span className="num">·</span>
              CROSS-BROKER INVENTORY
              <div className="right">
                <span className="tab on">All</span>
                {metrics.brokers.slice(0, 3).map(b => (
                  <span key={b} className="tab">{b}</span>
                ))}
                <span className="hsep-v"></span>
                <button className="btn-mini" onClick={() => setAdding(a => !a)}>{adding ? "× CLOSE" : "+ ADD"}</button>
                <button className="btn-mini ghost" onClick={resetSeed} title="Reset to seed">↺</button>
                <button className="btn-mini ghost" onClick={clearAll} title="Clear all">⌫</button>
              </div>
            </div>
            {adding && (
              <AddPositionForm
                onAdd={addPosition}
                onCancel={() => setAdding(false)}
                brokers={metrics.brokers.length ? metrics.brokers : ["IBKR", "Tiger"]}
              />
            )}
            <div className="pane-body">
              <InventoryTable onHover={onHover} onLeave={onLeave} onSelect={setSelected} selected={selected} />
            </div>
          </div>
          <div className="pane">
            <div className="pane-hdr">
              <span>02</span><span className="num">·</span>
              HOLDINGS HEATMAP
              <div className="right">
                <span className={"tab " + (heatMode === "day" ? "on" : "")} onClick={() => setHeatMode("day")}>Day Δ</span>
                <span className={"tab " + (heatMode === "sector" ? "on" : "")} onClick={() => setHeatMode("sector")}>Sector</span>
                <span className="src">ALL EX-CASH</span>
              </div>
            </div>
            <div className="pane-body" style={{display:"flex"}}>
              <Treemap onHover={onHover} onLeave={onLeave} mode={heatMode} />
            </div>
          </div>
          <div className="right-stack">
            <IntelFeed liveNews={liveNews} />
            {scouts.length > 0
              ? <ScoutFeed scouts={scouts} />
              : <NewsWire tickers={tickers} />
            }
          </div>
        </div>
        <div className="bottom">
          <MacroChart />
          <SecTracker liveFilings={liveFilings} />
          <DDPanel
            ticker={selected}
            ddData={ddData}
            ddLoading={ddLoading}
            ddPolling={ddPolling}
            ddIndex={ddIndex}
            onFetch={fetchDD}
            onTrigger={triggerDD}
          />
        </div>
        <StatusBar hovered={hover?.ticker || selected} />
        <InsightPopover ticker={hover?.ticker} anchor={hover?.anchor} fundamentals={fundamentals} />
      </div>
    </PortfolioCtx.Provider>
  );
}

// ─────────── Viewport-adaptive root ───────────
// Renders mobile layout for viewports < 768px, desktop otherwise.
// window.MobileApp is set by mobile.jsx which runs before this script.

const MobileView = window.MobileApp;

function RootApp() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  if (isMobile && MobileView) return <MobileView />;
  return <App />;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<RootApp />);
