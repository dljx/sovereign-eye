// Sovereign Engine — Mobile View
// Self-contained mobile app, rendered when viewport < 768px.
// Reads/writes positions from the same storage layer as desktop (KV + localStorage).

const { useState, useMemo, useEffect, useRef, useCallback } = React;
const { MY_POSITIONS: SEED, CONFIG, SECTOR_COLORS, SECTOR_OPTIONS, NEWS_SEED, WIRE_SEED } = window.SE_CONFIG;
const M_STORAGE_KEY = "se-positions-v1";

// ── Finnhub helpers ────────────────────────────────────────────────────────────
const M_FH = "https://finnhub.io/api/v1";
const mFhUrl = (path, params = "") =>
  `${M_FH}${path}?token=${CONFIG.FINNHUB_API_KEY}${params ? "&" + params : ""}`;
const mDelay = (ms) => new Promise(r => setTimeout(r, ms));

async function mFetchQuotes(tickers) {
  const symbols = tickers.filter(t => t !== "USD");
  const map = {};
  for (const sym of symbols) {
    try {
      const res = await fetch(mFhUrl("/quote", `symbol=${sym}`));
      if (res.ok) {
        const q = await res.json();
        if (q && q.c) map[sym] = { price: q.c, prevClose: q.pc, changePercent: q.dp || 0 };
      }
      await mDelay(120);
    } catch (e) { /* skip */ }
  }
  return Object.keys(map).length > 0 ? map : null;
}

async function mFetchNews(tickers) {
  const symbols = tickers.filter(t => t !== "USD").slice(0, 5);
  const results = [];
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  for (const sym of symbols) {
    try {
      const res = await fetch(mFhUrl("/company-news", `symbol=${sym}&from=${weekAgo}&to=${today}`));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) data.slice(0, 2).forEach(n => results.push({ ...n, ticker: sym }));
      }
      await mDelay(120);
    } catch (e) { /* skip */ }
  }
  return results.sort((a, b) => (b.datetime || 0) - (a.datetime || 0)).slice(0, 10);
}

async function mFetchProfile(ticker) {
  try {
    const res = await fetch(mFhUrl("/stock/profile2", `symbol=${ticker}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ticker ? data : null;
  } catch { return null; }
}

// ── KV sync ────────────────────────────────────────────────────────────────────
async function kvLoad() {
  try {
    const res = await fetch("/api/positions");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) { /* offline or KV not configured */ }
  return null;
}

async function kvSave(positions) {
  try {
    await fetch("/api/positions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(positions),
    });
  } catch (e) { /* fire and forget */ }
}

// ── Positions loading (KV → localStorage → seed) ──────────────────────────────
async function loadPositionsAsync() {
  const kv = await kvLoad();
  if (kv) return kv;
  try {
    const raw = localStorage.getItem(M_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length) return p;
    }
  } catch (e) {}
  return SEED;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
const mFmtMoney = (n, d = 2) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const mFmtCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
};
const mFmtPct = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d) + "%";

function mTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const M_SECTOR_MAP = {
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

// ── Enrich position with live quote data ──────────────────────────────────────
const mEnrich = (p, quotes) => {
  const q = quotes[p.ticker];
  const qty = +p.qty || 0;
  const avg = +p.avg || 0;
  const px = q ? q.price : avg;
  const dayP = q ? (q.changePercent || 0) : 0;
  const eq = qty * px;
  const cost = qty * avg;
  const upl = eq - cost;
  const uplP = cost ? (upl / cost) * 100 : 0;
  return { ...p, qty, avg, px, dayP, eq, cost, upl, uplP };
};

// ── Mini sparkline (deterministic) ────────────────────────────────────────────
function MobileSparkline() {
  const pts = Array.from({ length: 30 }, (_, i) =>
    50 + Math.sin(i * 0.4) * 8 + Math.cos(i * 0.7) * 4 + i * 0.3
  );
  const min = Math.min(...pts), max = Math.max(...pts);
  const W = 350, H = 50;
  const path = pts
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i / (pts.length - 1)) * W},${H - ((v - min) / (max - min)) * H}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="m-spark" preserveAspectRatio="none">
      <defs>
        <linearGradient id="msg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ade80" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${W},${H} L 0,${H} Z`} fill="url(#msg)" />
      <path d={path} fill="none" stroke="#4ade80" strokeWidth="1.5" />
    </svg>
  );
}

// ── Home tab: Glance view ──────────────────────────────────────────────────────
function MobileHomeTab({ m }) {
  const sign = m.dayPL >= 0 ? "+" : "-";
  return (
    <div>
      <div className="m-hero">
        <div className="m-hero-lbl">NET LIQUIDITY</div>
        <div className="m-hero-val">${mFmtMoney(m.totalEq, 0)}</div>
        <div className={"m-hero-day " + (m.dayPL >= 0 ? "pos" : "neg")}>
          {sign}${mFmtMoney(Math.abs(m.dayPL), 2)}
          <span className="m-hero-pct">{mFmtPct(m.dayPLP)}</span> today
        </div>
        <div className="m-hero-sub">
          <span>Cost ${mFmtCompact(m.totalCost)}</span>
          <span>·</span>
          <span className={m.totalUpl >= 0 ? "pos" : "neg"}>{mFmtPct(m.totalUplP, 1)} all-time</span>
        </div>
        <MobileSparkline />
      </div>

      <div className="m-stats-row">
        <div className="m-stat">
          <div className="m-stat-lbl">DAY P/L</div>
          <div className={"m-stat-val " + (m.dayPL >= 0 ? "pos" : "neg")}>
            {sign}${mFmtCompact(Math.abs(m.dayPL))}
          </div>
        </div>
        <div className="m-stat">
          <div className="m-stat-lbl">UNREALIZED</div>
          <div className={"m-stat-val " + (m.totalUpl >= 0 ? "pos" : "neg")}>
            {mFmtPct(m.totalUplP, 1)}
          </div>
        </div>
        <div className="m-stat">
          <div className="m-stat-lbl">POSITIONS</div>
          <div className="m-stat-val">{m.rows.length}</div>
        </div>
      </div>

      {m.movers.length > 0 && (
        <div className="m-section">
          <div className="m-sec-hdr">
            <span>TOP MOVERS</span>
            <span className="m-sec-meta">today</span>
          </div>
          <div className="m-movers">
            {m.movers.map(r => (
              <div key={r.ticker} className="m-mover">
                <div className="m-mv-tk">{r.ticker}</div>
                <div className="m-mv-name">{r.industry || r.sector}</div>
                <div className={"m-mv-pct " + (r.dayP >= 0 ? "pos" : "neg")}>{mFmtPct(r.dayP)}</div>
                <div className="m-mv-px">${mFmtMoney(r.px, 2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="m-section">
        <div className="m-sec-hdr">
          <span>ALLOCATION</span>
          <span className="m-sec-meta">{m.sectorList.length} sectors</span>
        </div>
        <div className="m-alloc-bar">
          {m.sectorList.map(s => (
            <div
              key={s.sector}
              className="m-alloc-seg"
              style={{ width: s.pct + "%", background: SECTOR_COLORS[s.sector] || "#71717a" }}
              title={s.sector + " " + s.pct.toFixed(1) + "%"}
            />
          ))}
        </div>
        <div className="m-alloc-list">
          {m.sectorList.map(s => (
            <div key={s.sector} className="m-alloc-row">
              <span className="m-alloc-sw" style={{ background: SECTOR_COLORS[s.sector] || "#71717a" }} />
              <span className="m-alloc-name">{s.sector}</span>
              <span className="m-alloc-eq">${mFmtCompact(s.eq)}</span>
              <span className="m-alloc-pct">{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Holdings tab ───────────────────────────────────────────────────────────────
function MobileHoldingsTab({ m, onAdd, onEdit, onRemove }) {
  const [sort, setSort] = useState("eq");
  const sorted = [...m.rows].sort((a, b) =>
    sort === "eq" ? b.eq - a.eq : sort === "day" ? b.dayP - a.dayP : b.uplP - a.uplP
  );

  return (
    <div>
      <div className="m-section">
        <div className="m-sort">
          {[{ id: "eq", l: "Value" }, { id: "day", l: "Day %" }, { id: "upl", l: "P/L %" }].map(s => (
            <button
              key={s.id}
              className={"m-sort-b " + (sort === s.id ? "on" : "")}
              onClick={() => setSort(s.id)}
            >{s.l}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button className="m-add-btn" onClick={onAdd}>+ ADD</button>
        </div>
        <div className="m-holdings">
          {sorted.length === 0 && (
            <div className="m-empty">
              No positions. Tap <b style={{ color: "var(--fg-1)" }}>+ ADD</b> to begin.
            </div>
          )}
          {sorted.map(r => (
            <MobileSwipeRow key={r.ticker + r.broker} r={r} onEdit={onEdit} onRemove={onRemove} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileSwipeRow({ r, onEdit, onRemove }) {
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const moving = useRef(false);
  const moved = useRef(false);
  const REVEAL = 80;

  const onStart = (e) => {
    startX.current = (e.touches ? e.touches[0].clientX : e.clientX);
    moving.current = true;
    moved.current = false;
  };
  const onMove = (e) => {
    if (!moving.current) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const d = Math.max(-100, Math.min(0, x - startX.current));
    if (Math.abs(d) > 6) moved.current = true;
    setDx(d);
  };
  const onEnd = () => {
    moving.current = false;
    setDx(dx < -REVEAL / 2 ? -REVEAL : 0);
  };
  const handleTap = () => { if (!moved.current && dx === 0) onEdit(r); };

  return (
    <div className="m-swipe">
      <button className="m-swipe-del" onClick={() => onRemove(r.ticker, r.broker)}>Delete</button>
      <div
        className="m-hold"
        style={{ transform: `translateX(${dx}px)`, transition: moving.current ? "none" : "transform .18s ease-out" }}
        onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        onClick={handleTap}
      >
        <div className="m-hold-l">
          <div className="m-hold-tk">
            {r.ticker}
            <span className="m-hold-br">{r.broker}</span>
          </div>
          <div className="m-hold-meta">{r.qty} @ ${mFmtMoney(r.avg)} · {r.industry || r.sector}</div>
        </div>
        <div className="m-hold-r">
          <div className="m-hold-val">${mFmtCompact(r.eq)}</div>
          <div className={"m-hold-day " + (r.dayP >= 0 ? "pos" : "neg")}>{mFmtPct(r.dayP)} today</div>
          <div className={"m-hold-upl " + (r.uplP >= 0 ? "pos" : "neg")}>{mFmtPct(r.uplP, 1)} unr.</div>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit bottom sheet ────────────────────────────────────────────────────
function MobilePositionSheet({ mode, initial, brokers, onClose, onSubmit, onDelete }) {
  const i = initial || {};
  const [ticker, setTicker]       = useState(i.ticker || "");
  const [name, setName]           = useState(i.name || "");
  const [broker, setBroker]       = useState(i.broker || brokers[0] || "IBKR");
  const [customBroker, setCustomBroker] = useState("");
  const [qty, setQty]             = useState(i.qty != null ? String(i.qty) : "");
  const [avg, setAvg]             = useState(i.avg != null ? String(i.avg) : "");
  const [sector, setSector]       = useState(i.sector || "Tech");
  const [industry, setIndustry]   = useState(i.industry || "");
  const [beta, setBeta]           = useState(i.beta != null ? String(i.beta) : "1.00");
  const [err, setErr]             = useState("");
  const [lookup, setLookup]       = useState(""); // "" | "loading" | "found" | "manual"
  const lookupTimer = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doLookup = useCallback(async (tk) => {
    if (!tk) return;
    setLookup("loading");
    const profile = await mFetchProfile(tk);
    if (profile) {
      if (!name) setName(profile.name || "");
      const mapped = M_SECTOR_MAP[profile.finnhubIndustry] || "";
      if (!sector || sector === "Tech") setSector(mapped || "Tech");
      if (!industry) setIndustry(profile.finnhubIndustry || "");
      setLookup("found");
    } else {
      setLookup("manual");
    }
  }, [name, sector, industry]);

  const onTickerChange = (e) => {
    const val = e.target.value;
    setTicker(val);
    setErr("");
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const tk = val.trim().toUpperCase();
    if (tk.length >= 1) lookupTimer.current = setTimeout(() => doLookup(tk), 700);
    else setLookup("");
  };

  const submit = (e) => {
    e?.preventDefault();
    const tk = ticker.trim().toUpperCase();
    if (!tk) return setErr("Ticker required");
    if (!qty || +qty <= 0) return setErr("Quantity must be > 0");
    if (!avg || +avg <= 0) return setErr("Avg cost must be > 0");
    const useBroker = broker === "__custom" ? customBroker.trim() : broker;
    if (!useBroker) return setErr("Broker required");
    onSubmit({
      ticker: tk,
      name: name.trim() || tk,
      broker: useBroker,
      qty: +qty,
      avg: +avg,
      sector,
      industry: industry.trim() || sector,
      beta: +beta || 1.0,
    });
  };

  const lookupHint =
    lookup === "loading" ? <span className="m-fld-lbl-hint">· looking up…</span> :
    lookup === "found"   ? <span className="m-fld-lbl-hint" style={{color:"var(--pos)"}}>· found</span> :
    lookup === "manual"  ? <span className="m-fld-lbl-hint" style={{color:"var(--fg-4)"}}>· manual</span> :
    null;

  return (
    <div className="m-sheet-bg" onClick={onClose}>
      <form className="m-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="m-sheet-grab" />
        <div className="m-sheet-hdr">
          <span className="m-sheet-title">
            {mode === "add" ? "ADD POSITION" : "EDIT " + (initial?.ticker || "")}
          </span>
          <button type="button" className="m-sheet-x" onClick={onClose}>×</button>
        </div>
        <div className="m-sheet-body">
          <div className="m-fld">
            <label>Ticker{lookupHint}</label>
            <input
              value={ticker}
              onChange={onTickerChange}
              placeholder="NVDA"
              style={{ textTransform: "uppercase" }}
              disabled={mode === "edit"}
              autoCapitalize="characters"
            />
          </div>
          <div className="m-fld">
            <label>Name <span className="m-fld-lbl-hint">· auto</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" />
          </div>
          <div className="m-fld">
            <label>Broker</label>
            <select value={broker} onChange={(e) => setBroker(e.target.value)}>
              {brokers.map(b => <option key={b} value={b}>{b}</option>)}
              <option value="__custom">+ Add new broker…</option>
            </select>
            {broker === "__custom" && (
              <input
                value={customBroker}
                onChange={(e) => setCustomBroker(e.target.value)}
                placeholder="e.g. Schwab"
                style={{ marginTop: 6 }}
              />
            )}
          </div>
          <div className="m-fld-row">
            <div className="m-fld">
              <label>Qty</label>
              <input type="number" inputMode="decimal" step="any" value={qty}
                onChange={(e) => { setQty(e.target.value); setErr(""); }} placeholder="100" />
            </div>
            <div className="m-fld">
              <label>Avg Cost</label>
              <input type="number" inputMode="decimal" step="any" value={avg}
                onChange={(e) => { setAvg(e.target.value); setErr(""); }} placeholder="120.50" />
            </div>
          </div>
          <div className="m-fld-row">
            <div className="m-fld">
              <label>Sector <span className="m-fld-lbl-hint">· auto</span></label>
              <select value={sector} onChange={(e) => setSector(e.target.value)}>
                {SECTOR_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="m-fld">
              <label>Beta</label>
              <input type="number" inputMode="decimal" step="0.01" value={beta}
                onChange={(e) => setBeta(e.target.value)} />
            </div>
          </div>
          {industry !== "" && (
            <div className="m-fld">
              <label>Industry <span className="m-fld-lbl-hint">· auto</span></label>
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="optional" />
            </div>
          )}
          {err && <div className="m-fld-err">{err}</div>}
        </div>
        <div className="m-sheet-foot">
          {onDelete && (
            <button type="button" className="m-btn-del" onClick={onDelete}>Delete</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="m-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="m-btn primary">{mode === "add" ? "Add" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

// ── Wire tab ───────────────────────────────────────────────────────────────────
function MobileWireTab({ m, liveNews }) {
  const tickers = new Set(m.rows.map(r => r.ticker));

  // Normalize live Finnhub news or fall back to seed
  const items = useMemo(() => {
    if (liveNews && liveNews.length > 0) {
      return liveNews.slice(0, 10).map(n => ({
        ticker: n.ticker || n.related || "MACRO",
        src: n.source || n.src || "—",
        ago: n.datetime ? mTimeAgo(new Date(n.datetime * 1000).toISOString()) : (n.ago || "—"),
        title: n.headline || n.title || "",
        severity: "info",
      }));
    }
    // Fall back to WIRE_SEED adapted to mobile format
    return WIRE_SEED.filter(n => n.tag === "MACRO" || tickers.has(n.ticker_or_sector)).slice(0, 10).map(n => ({
      ticker: n.tag === "MACRO" ? "MACRO" : (n.ticker_or_sector || "—"),
      src: n.source || "—",
      ago: n.ago || "—",
      title: n.headline || "",
      severity: n.severity || "info",
    }));
  }, [liveNews, m.rows]);

  return (
    <div className="m-section">
      <div className="m-sec-hdr">
        <span>NEWS WIRE</span>
        <span className="m-sec-meta">{liveNews.length > 0 ? "FINNHUB" : "SEED"}</span>
      </div>
      <div className="m-wire">
        {items.length === 0 && (
          <div className="m-wire-empty">No headlines for your positions.</div>
        )}
        {items.map((n, i) => (
          <div key={i} className={"m-wire-item sev-" + (n.severity || "info")}>
            <div className="m-wire-meta">
              <span className="m-wire-tk">{n.ticker || "MACRO"}</span>
              <span className="m-wire-src">{n.src || n.source}</span>
              <span className="m-wire-ago">{n.ago}</span>
            </div>
            <div className="m-wire-ttl">{n.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Macro tab ──────────────────────────────────────────────────────────────────
function MobileMacroTab({ m }) {
  const portBeta = m.totalEq > 0
    ? m.rows.reduce((s, r) => s + (r.eq / m.totalEq) * (r.beta || 1), 0)
    : 0;

  return (
    <div className="m-section">
      <div className="m-sec-hdr"><span>MACRO SNAPSHOT</span></div>
      <div className="m-macro-grid">
        {[
          { l: "S&P 500",   v: "5,924.32", d: +0.41 },
          { l: "NASDAQ",    v: "19,824.1",  d: +0.88 },
          { l: "10Y YIELD", v: "4.12%",     d: -0.04 },
          { l: "10Y–2Y",    v: "+38 bps",   d: +0.02 },
          { l: "DXY",       v: "103.84",    d: -0.21 },
          { l: "VIX",       v: "14.24",     d: -2.41 },
          { l: "BRENT",     v: "$78.41",    d: -2.92 },
          { l: "GOLD",      v: "$2,418",    d: +0.58 },
        ].map(x => (
          <div key={x.l} className="m-macro-cell">
            <div className="m-macro-lbl">{x.l}</div>
            <div className="m-macro-val">{x.v}</div>
            <div className={"m-macro-d " + (x.d >= 0 ? "pos" : "neg")}>{mFmtPct(x.d)}</div>
          </div>
        ))}
      </div>
      <div className="m-section-inner">
        <div className="m-sec-hdr"><span>PORTFOLIO β</span></div>
        <div className="m-beta">
          <div className="m-beta-val">{portBeta.toFixed(2)}</div>
          <div className="m-beta-lbl">vs S&amp;P 500 · weighted avg</div>
        </div>
      </div>
    </div>
  );
}

// ── Root Mobile App ─────────────────────────────────────────────────────────────
function MobileApp() {
  const [positions, setPositions] = useState(null); // null = loading
  const [quotes, setQuotes]       = useState({});
  const [liveNews, setLiveNews]   = useState([]);
  const [tab, setTab]             = useState("home");
  const [now, setNow]             = useState(new Date());
  const [sheet, setSheet]         = useState(null); // null | "add" | { edit: position }
  const [syncStatus, setSyncStatus] = useState(""); // "" | "syncing" | "synced"

  // Load positions on mount (KV → localStorage → seed)
  useEffect(() => {
    loadPositionsAsync().then(p => setPositions(p));
  }, []);

  // Save to localStorage + KV on change
  useEffect(() => {
    if (positions === null) return;
    try { localStorage.setItem(M_STORAGE_KEY, JSON.stringify(positions)); } catch (e) {}
    setSyncStatus("syncing");
    kvSave(positions)
      .then(() => { setSyncStatus("synced"); setTimeout(() => setSyncStatus(""), 2000); })
      .catch(() => setSyncStatus(""));
  }, [positions]);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch Finnhub quotes on load and refresh
  const tickers = useMemo(() => positions ? positions.map(p => p.ticker) : [], [positions]);

  const fetchLive = useCallback(async () => {
    if (!tickers.length) return;
    const q = await mFetchQuotes(tickers);
    if (q) setQuotes(q);
    const n = await mFetchNews(tickers);
    if (n && n.length) setLiveNews(n);
  }, [tickers]);

  useEffect(() => {
    if (!tickers.length) return;
    fetchLive();
    const interval = setInterval(fetchLive, CONFIG.REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchLive]);

  // Position CRUD
  const addPosition = useCallback((p) => {
    setPositions(prev => [...prev, p]);
    setSheet(null);
  }, []);

  const updatePosition = useCallback((orig, next) => {
    setPositions(prev =>
      prev.map(p => (p.ticker === orig.ticker && p.broker === orig.broker) ? { ...p, ...next } : p)
    );
    setSheet(null);
  }, []);

  const removePosition = useCallback((ticker, broker) => {
    setPositions(prev => prev.filter(p => !(p.ticker === ticker && p.broker === broker)));
  }, []);

  // Derived metrics
  const m = useMemo(() => {
    if (!positions) return { rows: [], totalEq: 0, totalCost: 0, totalUpl: 0, totalUplP: 0, dayPL: 0, dayPLP: 0, sectorList: [], movers: [] };
    const rows = positions.map(p => mEnrich(p, quotes));
    const totalEq   = rows.reduce((s, r) => s + r.eq, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const dayPL     = rows.reduce((s, r) => s + r.eq * (r.dayP / 100), 0);
    const sectors   = {};
    rows.forEach(r => { sectors[r.sector] = (sectors[r.sector] || 0) + r.eq; });
    const sectorList = Object.entries(sectors)
      .map(([s, v]) => ({ sector: s, eq: v, pct: totalEq ? (v / totalEq) * 100 : 0 }))
      .sort((a, b) => b.eq - a.eq);
    const movers = [...rows]
      .filter(r => r.sector !== "Cash")
      .sort((a, b) => Math.abs(b.dayP) - Math.abs(a.dayP))
      .slice(0, 5);
    return {
      rows, totalEq, totalCost,
      totalUpl: totalEq - totalCost,
      totalUplP: totalCost ? ((totalEq - totalCost) / totalCost) * 100 : 0,
      dayPL, dayPLP: totalEq ? (dayPL / totalEq) * 100 : 0,
      sectorList, movers,
    };
  }, [positions, quotes]);

  if (positions === null) {
    return <div className="m-app m-loading">SOVEREIGN ENGINE · LOADING…</div>;
  }

  const time = now.toTimeString().slice(0, 5);
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // NYSE open/closed
  const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h_ = nyNow.getHours(), mi_ = nyNow.getMinutes(), dy_ = nyNow.getDay();
  const isOpen = dy_ >= 1 && dy_ <= 5 && (h_ > 9 || (h_ === 9 && mi_ >= 30)) && h_ < 16;

  const existingBrokers = Array.from(new Set(positions.map(p => p.broker)));

  return (
    <div className="m-app">
      {/* Header */}
      <div className="m-header">
        <div>
          <div className="m-brand">SOVEREIGN ENGINE</div>
          <div className="m-date">{date} · {time} · {m.rows.length} positions</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div className="m-live"><span className="m-dot" />{isOpen ? "NYSE · OPEN" : "NYSE · CLOSED"}</div>
          {syncStatus && (
            <div className={"m-sync-badge " + syncStatus}>
              {syncStatus === "syncing" ? "● SYNCING" : "✓ SYNCED"}
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="m-scroll">
        {tab === "home"     && <MobileHomeTab m={m} />}
        {tab === "holdings" && (
          <MobileHoldingsTab
            m={m}
            onAdd={() => setSheet("add")}
            onEdit={(p) => setSheet({ edit: p })}
            onRemove={removePosition}
          />
        )}
        {tab === "wire"  && <MobileWireTab m={m} liveNews={liveNews} />}
        {tab === "macro" && <MobileMacroTab m={m} />}
      </div>

      {/* Add / edit bottom sheet */}
      {sheet && (
        <MobilePositionSheet
          mode={sheet === "add" ? "add" : "edit"}
          initial={sheet.edit}
          brokers={existingBrokers.length ? existingBrokers : ["IBKR", "Tiger"]}
          onClose={() => setSheet(null)}
          onSubmit={(p) => sheet === "add" ? addPosition(p) : updatePosition(sheet.edit, p)}
          onDelete={sheet.edit
            ? () => { removePosition(sheet.edit.ticker, sheet.edit.broker); setSheet(null); }
            : null}
        />
      )}

      {/* Tab bar */}
      <div className="m-tabs">
        {[
          { id: "home",     ic: "◐", lbl: "Glance"   },
          { id: "holdings", ic: "≡", lbl: "Holdings"  },
          { id: "wire",     ic: "◆", lbl: "Wire"      },
          { id: "macro",    ic: "◇", lbl: "Macro"     },
        ].map(t => (
          <button
            key={t.id}
            className={"m-tab " + (tab === t.id ? "on" : "")}
            onClick={() => setTab(t.id)}
          >
            <span className="m-tab-ic">{t.ic}</span>
            <span className="m-tab-lbl">{t.lbl}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Expose globally so app.jsx can reference it after this script runs
window.MobileApp = MobileApp;
