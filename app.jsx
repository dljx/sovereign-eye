// ─────────── Sovereign Eye — Portfolio Intelligence Dashboard ───────────
// Live data fetched from FMP API. Positions defined in positions.js.

const { useState, useMemo, useRef, useEffect, useCallback } = React;
const { MY_POSITIONS, CONFIG, SECTOR_COLORS } = window.SE_CONFIG;

// ─────────── FMP API helpers ───────────
const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const fmpUrl = (path, params = "") =>
  `${FMP_BASE}${path}?apikey=${CONFIG.FMP_API_KEY}${params ? "&" + params : ""}`;

async function fetchQuotes(tickers) {
  const symbols = tickers.filter(t => t !== "USD").join(",");
  if (!symbols) return {};
  try {
    const res = await fetch(fmpUrl(`/quote/${symbols}`));
    if (!res.ok) throw new Error(`FMP ${res.status}`);
    const data = await res.json();
    const map = {};
    data.forEach(q => { map[q.symbol] = q; });
    return map;
  } catch (e) {
    console.error("FMP quote fetch failed:", e);
    return null;
  }
}

async function fetchKeyMetrics(ticker) {
  try {
    const res = await fetch(fmpUrl(`/key-metrics-ttm/${ticker}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}

async function fetchRatios(ticker) {
  try {
    const res = await fetch(fmpUrl(`/ratios-ttm/${ticker}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}

async function fetchDCF(ticker) {
  try {
    const res = await fetch(fmpUrl(`/discounted-cash-flow/${ticker}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}

async function fetchNews(tickers) {
  const symbols = tickers.filter(t => t !== "USD").slice(0, 10).join(",");
  try {
    const res = await fetch(fmpUrl("/stock_news", `tickers=${symbols}&limit=8`));
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function fetchSECFilings(tickers) {
  const results = [];
  const top6 = tickers.filter(t => t !== "USD").slice(0, 6);
  for (const ticker of top6) {
    try {
      const res = await fetch(fmpUrl(`/sec_filings/${ticker}`, "limit=2"));
      if (res.ok) {
        const data = await res.json();
        data.forEach(f => results.push({ ...f, ticker }));
      }
    } catch { /* skip */ }
  }
  return results.sort((a, b) => new Date(b.fillingDate || b.date) - new Date(a.fillingDate || a.date)).slice(0, 8);
}

// ─────────── Formatting helpers ───────────
const fmtMoney = (n, d = 2) => {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + abs.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtCompact = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n/1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n/1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n/1e3).toFixed(1) + "K";
  return n.toFixed(0);
};
const fmtPct = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d) + "%";

const heatColor = (pct) => {
  const t = Math.max(-5, Math.min(5, pct)) / 5;
  if (t >= 0) {
    const a = 0.18 + t * 0.55;
    return `rgba(34, 197, 94, ${a.toFixed(3)})`;
  } else {
    const a = 0.18 + (-t) * 0.55;
    return `rgba(239, 68, 68, ${a.toFixed(3)})`;
  }
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─────────── Loading Screen ───────────
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="mark"></div>
      <div className="title">SOVEREIGN EYE</div>
      <div className="sub">FETCHING LIVE MARKET DATA...</div>
      <div className="loading-spinner"></div>
    </div>
  );
}

// ─────────── Command bar ───────────
function CommandBar({ rows, totalEq, totalCost, dayPl, dayPlP, portBeta, sectorBreakdown }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const ts = now.toISOString().replace("T", " ").slice(0, 19) + "Z";

  const totalUpl = totalEq - totalCost;
  const totalUplP = totalCost > 0 ? (totalUpl / totalCost) * 100 : 0;

  const brokers = {};
  rows.forEach(r => { brokers[r.broker] = (brokers[r.broker] || 0) + r.eq; });
  const brokerEntries = Object.entries(brokers).sort((a, b) => b[1] - a[1]);
  const topSector = sectorBreakdown[0];

  // Determine market status
  const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = nyNow.getHours(), m = nyNow.getMinutes();
  const day = nyNow.getDay();
  const isOpen = day >= 1 && day <= 5 && (h > 9 || (h === 9 && m >= 30)) && h < 16;

  return (
    <div className="cmd">
      <div className="brand">
        <div className="mark"></div>
        <div>
          <div className="name">SOVEREIGN EYE<span className="ver">v1.0</span></div>
          <div style={{fontFamily:"var(--mono)", fontSize:9.5, color:"var(--fg-3)", letterSpacing:"0.1em", marginTop:2}}>PORTFOLIO INTELLIGENCE · READ-ONLY</div>
        </div>
      </div>

      <div className="cmd-stats">
        <div className="stat" style={{minWidth:240}}>
          <div className="lbl">TOTAL NET LIQUIDITY <span className="src">USD · CONSOLIDATED</span></div>
          <div className="val">${fmtMoney(totalEq, 2)}<span className="sub">Cost ${fmtCompact(totalCost)}</span></div>
          <div className={"delta " + (totalUpl >= 0 ? "pl-pos" : "pl-neg")}>
            {fmtPct(totalUplP)} unrealized · ${fmtMoney(totalUpl, 0)}
          </div>
        </div>
        <div className={"stat " + (dayPl >= 0 ? "pos" : "neg")} style={{minWidth:200}}>
          <div className="lbl">24H P/L <span className="src">VS. PREV CLOSE</span></div>
          <div className="val">{dayPl >= 0 ? "+" : ""}${fmtMoney(Math.abs(dayPl), 0)}</div>
          <div className="delta">{fmtPct(dayPlP)} · {dayPl >= 0 ? "▲" : "▼"} session</div>
        </div>
        <div className="stat" style={{minWidth:180}}>
          <div className="lbl">PORTFOLIO BETA <span className="src">vs SPX · LIVE</span></div>
          <div className="val">{portBeta.toFixed(2)}<span className="sub">σ {(portBeta*16).toFixed(1)}%</span></div>
          <div className="delta fg-2">{topSector ? `${topSector.sector} ${topSector.pct.toFixed(1)}%` : ""} · {sectorBreakdown.length} sectors</div>
        </div>
        <div className="stat" style={{minWidth:180}}>
          <div className="lbl">BROKER SPLIT <span className="src">{brokerEntries.length} ACCOUNTS</span></div>
          <div className="val" style={{fontSize:14}}>
            {brokerEntries.map(([ name, eq ], i) => (
              <span key={name} style={{color: i === 0 ? "var(--ibkr)" : "var(--tiger)", marginRight: 8}}>
                {name.toUpperCase()} {((eq/totalEq)*100).toFixed(1)}%
              </span>
            ))}
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
function SubBar({ dataStatus, rows, lastSync }) {
  const sources = [
    { name: "FMP QUOTES", ok: dataStatus.quotes },
    { name: "FMP NEWS", ok: dataStatus.news },
    { name: "SEC EDGAR", ok: dataStatus.sec },
  ];
  const syncAgo = lastSync ? Math.floor((Date.now() - lastSync) / 1000) : "—";
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
        <span>SECTORS <b>{new Set(rows.map(r => r.sector)).size}</b></span>
        <span>FX <b>USD</b></span>
        <span>LAST SYNC <b>{typeof syncAgo === "number" ? syncAgo + "s" : syncAgo}</b></span>
      </span>
    </div>
  );
}

// ─────────── Sparkline (deterministic) ───────────
function Sparkline({ ticker, dayP }) {
  const seed = ticker.split("").reduce((a,c) => a + c.charCodeAt(0), 0);
  const bars = Array.from({length: 18}, (_, i) => {
    const v = Math.sin((seed + i*1.7) * 0.7) * 0.5 + Math.cos((seed*0.3 + i)*1.1) * 0.3;
    return v;
  });
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
  { id: "ticker", label: "Ticker",       w: 170, align: "left" },
  { id: "broker", label: "Broker",       w: 70  },
  { id: "qty",    label: "Qty",          w: 65  },
  { id: "avg",    label: "Avg Cost",     w: 80  },
  { id: "px",     label: "Last",         w: 80  },
  { id: "dayP",   label: "Day %",        w: 70  },
  { id: "eq",     label: "Mkt Value",    w: 105 },
  { id: "uplP",   label: "Unr P/L %",    w: 80  },
  { id: "weight", label: "Weight",       w: 130 },
  { id: "beta",   label: "β",            w: 50  },
];

function InventoryTable({ rows, totalEq, portBeta, dayPlP, onHover, onLeave, onSelect, selected }) {
  const [sortKey, setSortKey] = useState("eq");
  const [sortDir, setSortDir] = useState("desc");

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

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalUplP = totalCost > 0 ? ((totalEq - totalCost) / totalCost) * 100 : 0;

  return (
    <table className="tbl">
      <thead>
        <tr>
          {COLS.map(c => (
            <th key={c.id} style={{width: c.w, textAlign: c.align || "right"}} onClick={() => onSort(c.id)}>
              {c.label}{arr(c.id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => {
          const w = totalEq > 0 ? (r.eq / totalEq) * 100 : 0;
          return (
            <tr key={r.ticker}
                className={selected === r.ticker ? "sel" : ""}
                onMouseEnter={(e) => onHover(r.ticker, e.currentTarget)}
                onMouseLeave={onLeave}
                onClick={() => onSelect(r.ticker)}>
              <td>
                <span className="tkr">
                  <span className="glyph">{r.ticker.slice(0,2)}</span>
                  {r.ticker}
                </span>
                <Sparkline ticker={r.ticker} dayP={r.dayP} />
                <div style={{fontFamily:"var(--sans)", fontSize:10, color:"var(--fg-3)", marginTop:2, marginLeft:26}}>
                  {r.name} · <span style={{color:"var(--fg-4)"}}>{r.sector}</span>
                </div>
              </td>
              <td><span className={"broker-tag " + r.broker.toLowerCase()}>{r.broker.toUpperCase()}</span></td>
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
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td><span style={{fontFamily:"var(--mono)", color:"var(--fg-2)", fontSize:9.5, letterSpacing:"0.1em"}}>CONSOLIDATED · {rows.length} POS</span></td>
          <td colSpan={2} className="fg-3" style={{textAlign:"right"}}>—</td>
          <td className="fg-3">—</td>
          <td className="fg-3">—</td>
          <td className={dayPlP >= 0 ? "pl-pos" : "pl-neg"}>{fmtPct(dayPlP)}</td>
          <td style={{color:"var(--fg-0)"}}>${fmtCompact(totalEq)}</td>
          <td className={totalUplP >= 0 ? "pl-pos" : "pl-neg"}>{fmtPct(totalUplP, 1)}</td>
          <td className="fg-3">100.0%</td>
          <td className="fg-2">{portBeta.toFixed(2)}</td>
        </tr>
      </tfoot>
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
      const hw = w * ratio;
      let hy = y;
      head.forEach(it => { const ih = h * (it.value / headTot); result.push({ ...it, x, y: hy, w: hw, h: ih }); hy += ih; });
      layout(tail, x + hw, y, w - hw, h);
    } else {
      const hh = h * ratio;
      let hx = x;
      head.forEach(it => { const iw = w * (it.value / headTot); result.push({ ...it, x: hx, y, w: iw, h: hh }); hx += iw; });
      layout(tail, x, y + hh, w, h - hh);
    }
  }
  layout(items, x, y, w, h);
  return result;
}

function Treemap({ rows, onHover, onLeave, mode }) {
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
    .filter(r => r.sector !== "Cash")
    .map(r => ({ ticker: r.ticker, value: r.eq, dayP: r.dayP, eq: r.eq, broker: r.broker, sector: r.sector, industry: r.industry }))
    .sort((a, b) => b.value - a.value);

  const cells = squarify(items, 0, 0, size.w, size.h);

  const sectorBreakdown = (() => {
    const m = {};
    items.forEach(r => { m[r.sector] = (m[r.sector] || 0) + r.eq; });
    const total = items.reduce((s, r) => s + r.eq, 0);
    return Object.entries(m).map(([k, v]) => ({ sector: k, pct: (v/total)*100 })).sort((a,b) => b.pct - a.pct);
  })();

  return (
    <div className="tree-wrap">
      <div ref={wrapRef} style={{position:"relative", minHeight:0, flex:1}}>
        <svg className="tree-svg" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          {cells.map(c => {
            const fill = mode === "sector"
              ? (SECTOR_COLORS[c.sector] || "#71717a") + "66"
              : heatColor(c.dayP);
            const showFull = c.w > 70 && c.h > 50;
            const showMini = c.w > 36 && c.h > 22;
            const px = c.x + 8, py = c.y + 16;
            return (
              <g key={c.ticker}
                 onMouseEnter={(e) => onHover(c.ticker, e.currentTarget)}
                 onMouseLeave={onLeave}>
                <rect className="cell" x={c.x} y={c.y} width={c.w} height={c.h} fill={fill} />
                {showFull && (
                  <>
                    <text className="lbl-tkr" x={px} y={py} fontSize={Math.min(22, c.w/4.5, c.h/3)}>{c.ticker}</text>
                    <text className="lbl-px"  x={px} y={py + Math.min(20, c.h/3.4)} fontSize={Math.min(13, c.w/8)}>{fmtPct(c.dayP)}</text>
                    <text className="lbl-meta" x={px} y={c.y + c.h - 18} fontSize={10}>${fmtCompact(c.eq)}</text>
                    <text className="lbl-meta" x={px} y={c.y + c.h - 6} fontSize={9.5}>{c.broker.toUpperCase()} · {c.industry}</text>
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
          <>
            {sectorBreakdown.map(s => (
              <span key={s.sector} className="label">
                <span className="sw" style={{background: (SECTOR_COLORS[s.sector] || "#71717a") + "99", width: 10, height: 10}}></span>
                {s.sector} {s.pct.toFixed(0)}%
              </span>
            ))}
          </>
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

// ─────────── Intelligence Feed (News) ───────────
function IntelFeed({ news }) {
  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>03</span><span className="num">·</span>
        NEWS FEED
        <div className="right">
          <span className="tab on">Latest</span>
          <span className="src">FMP · LIVE</span>
        </div>
      </div>
      <div className="pane-body intel">
        {news.length === 0 ? (
          <div className="no-data">LOADING NEWS...</div>
        ) : (
          <div className="news">
            {news.map((n, i) => (
              <div key={i} className="news-item">
                <div className="meta">
                  <span className="src">{n.site || n.source || "—"}</span>
                  <span className="ago">{timeAgo(n.publishedDate || n.date)}</span>
                </div>
                <div className="ttl">{n.title}</div>
                <span className="tk">{n.symbol || n.ticker || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── Macro chart (portfolio NAV) ───────────
function MacroChart({ rows, totalEq }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 200 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(300, r.width), h: Math.max(120, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Generate a synthetic equity curve from positions (cost → current)
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const steps = 14;
  const portfolio = Array.from({length: steps}, (_, i) => {
    const t = i / (steps - 1);
    return 100 + ((totalEq / totalCost) - 1) * 100 * t;
  });
  const labels = Array.from({length: steps}, (_, i) => i === steps - 1 ? "Now" : `M-${steps - 1 - i}`);

  const padL = 38, padR = 18, padT = 16, padB = 22;
  const W = size.w - padL - padR;
  const H = size.h - padT - padB;

  const lMin = Math.min(...portfolio) - 2;
  const lMax = Math.max(...portfolio) + 2;

  const xAt = (i) => padL + (i / (labels.length - 1)) * W;
  const yL  = (v) => padT + H - ((v - lMin) / (lMax - lMin)) * H;

  const pathD = portfolio.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${yL(v).toFixed(2)}`).join(" ");
  const areaD = `${pathD} L ${xAt(portfolio.length-1)} ${padT+H} L ${xAt(0)} ${padT+H} Z`;

  const gridL = [];
  for (let i = 0; i <= 4; i++) {
    const v = lMin + (i / 4) * (lMax - lMin);
    gridL.push({ v, y: yL(v) });
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>04</span><span className="num">·</span>
        EQUITY CURVE
        <div className="right">
          <span className="tab on">NAV Index</span>
          <span className="src">SYNTHETIC</span>
        </div>
      </div>
      <div className="pane-body" style={{display:"flex", flexDirection:"column"}}>
        <div className="macro-wrap">
          <div className="macro-axis-row">
            <div className="legend">
              <span className="it"><span className="sw" style={{background:"var(--fg-0)"}}></span>Portfolio NAV (idx=100)</span>
            </div>
            <div>
              NAV <span style={{color: totalEq >= totalCost ? "var(--pos)" : "var(--neg)"}}>
                {fmtPct(((totalEq / totalCost) - 1) * 100)}
              </span> since inception
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
              <path d={areaD} fill="rgba(244,244,245,0.06)" />
              <path d={pathD} fill="none" stroke="var(--fg-0)" strokeWidth="1.5" />
              <line className="ax" x1={padL} x2={padL} y1={padT} y2={padT + H} />
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

// ─────────── SEC tracker ───────────
function SecTracker({ filings }) {
  return (
    <div className="pane">
      <div className="pane-hdr">
        <span>05</span><span className="num">·</span>
        SEC FILINGS
        <div className="right">
          <span className="tab on">All Forms</span>
          <span className="src">EDGAR · FMP</span>
        </div>
      </div>
      <div className="pane-body sec">
        <div className="sec-hdr">
          <span>FORM</span>
          <span>TKR</span>
          <span>FILED</span>
          <span>TITLE</span>
          <span style={{textAlign:"right"}}>LINK</span>
        </div>
        {filings.length === 0 ? (
          <div className="no-data">LOADING SEC FILINGS...</div>
        ) : filings.map((f, i) => {
          const formType = (f.type || f.form || "").toUpperCase();
          const cls = formType.includes("10-Q") ? "q" : formType.includes("10-K") ? "k" : "f";
          const dateStr = f.fillingDate || f.date || "";
          return (
            <div key={i} className="sec-row">
              <span className={"form " + cls}>{formType.slice(0, 6)}</span>
              <span style={{color:"var(--fg-0)", fontWeight:600}}>{f.ticker || f.symbol}</span>
              <span style={{color:"var(--fg-2)"}}>{dateStr.slice(0, 10)}</span>
              <span className="tldr">
                <span>{(f.title || f.description || "Filing").slice(0, 80)}</span>
              </span>
              <span className="url">
                {f.finalLink ? <a href={f.finalLink} target="_blank" rel="noopener" style={{color:"var(--fg-4)"}}>View</a> : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── Insight popover (FMP) ───────────
function InsightPopover({ ticker, anchor, rows, fundamentals }) {
  if (!ticker || !anchor) return null;
  const r = rows.find(x => x.ticker === ticker);
  if (!r) return null;
  const f = fundamentals[ticker];

  const rect = anchor.getBoundingClientRect();
  const W = 320, H = 320;
  let left = rect.right + 12;
  let top = rect.top;
  if (left + W > window.innerWidth - 8) left = rect.left - W - 12;
  if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8;
  if (top < 8) top = 8;

  if (!f) {
    return (
      <div className="popover" style={{ left, top }}>
        <div className="pop-hdr">
          <span className="tk">{ticker}</span>
          <span className="nm">{r.name}</span>
          <span className="src">FMP</span>
        </div>
        <div style={{padding: 16, color: "var(--fg-3)", fontFamily: "var(--mono)", fontSize: 10}}>
          Loading fundamentals...
        </div>
      </div>
    );
  }

  const upside = f.dcf ? ((f.dcf - r.px) / r.px) * 100 : null;

  return (
    <div className="popover" style={{ left, top }}>
      <div className="pop-hdr">
        <span className="tk">{ticker}</span>
        <span className="nm">{r.name}</span>
        <span className="src">FMP</span>
      </div>
      <div className="pop-grid">
        {f.dcf != null && (
          <div className="cell">
            <div className="k">DCF Fair Value</div>
            <div className="v">${fmtMoney(f.dcf, 2)}</div>
          </div>
        )}
        {upside != null && (
          <div className="cell">
            <div className="k">Upside vs Last</div>
            <div className={"v " + (upside >= 0 ? "pos" : "neg")}>{fmtPct(upside, 1)}</div>
          </div>
        )}
        {f.pe != null && (
          <div className="cell">
            <div className="k">P/E (TTM)</div>
            <div className="v">{f.pe.toFixed(1)}</div>
          </div>
        )}
        {f.pfcf != null && (
          <div className="cell">
            <div className="k">P/FCF</div>
            <div className="v">{f.pfcf.toFixed(1)}</div>
          </div>
        )}
        {f.de != null && (
          <div className="cell">
            <div className="k">Debt / Equity</div>
            <div className="v">{f.de.toFixed(2)}<small>x</small></div>
          </div>
        )}
        {f.gm != null && (
          <div className="cell">
            <div className="k">Gross Margin</div>
            <div className="v">{(f.gm * 100).toFixed(1)}<small>%</small></div>
          </div>
        )}
        {f.roic != null && (
          <div className="cell">
            <div className="k">ROIC</div>
            <div className="v">{(f.roic * 100).toFixed(1)}<small>%</small></div>
          </div>
        )}
        <div className="cell">
          <div className="k">Beta</div>
          <div className="v">{(r.beta || 0).toFixed(2)}</div>
        </div>
      </div>
      <div className="pop-foot">
        <span>FMP · /v3/discounted-cash-flow/{ticker}</span>
        {upside != null && (
          <span className={upside >= 0 ? "upside" : "down"}>
            {upside >= 0 ? "▲" : "▼"} {fmtPct(upside, 1)} to fair
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────── Status bar ───────────
function StatusBar({ hovered }) {
  return (
    <div className="status">
      <span className="item"><span style={{color:"var(--pos)"}}>●</span> LIVE</span>
      <span className="item">MODE <b>READ-ONLY</b></span>
      <span className="item">BOOK <b>SOVEREIGN-EYE</b></span>
      <span className="item">FX BASE <b>USD</b></span>
      <span className="spacer"></span>
      <span className="item">FOCUS <b>{hovered || "—"}</b></span>
      <span className="item">LAYOUT <b>4-PANE</b></span>
      <span className="item" style={{color:"var(--fg-4)"}}>NO ORDER ENTRY · ANALYSIS ONLY</span>
    </div>
  );
}

// ─────────── Root App ───────────
function App() {
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState({});
  const [news, setNews] = useState([]);
  const [filings, setFilings] = useState([]);
  const [fundamentals, setFundamentals] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const [dataStatus, setDataStatus] = useState({ quotes: false, news: false, sec: false });
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(MY_POSITIONS[0]?.ticker || "");
  const [heatMode, setHeatMode] = useState("day");

  const tickers = useMemo(() => MY_POSITIONS.map(p => p.ticker), []);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    const status = { quotes: false, news: false, sec: false };

    const q = await fetchQuotes(tickers);
    if (q) { setQuotes(q); status.quotes = true; }

    const n = await fetchNews(tickers);
    if (n.length) { setNews(n); status.news = true; }

    const f = await fetchSECFilings(tickers);
    if (f.length) { setFilings(f); status.sec = true; }

    setDataStatus(status);
    setLastSync(Date.now());
    setLoading(false);
  }, [tickers]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, CONFIG.REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Fetch fundamentals on hover
  const fetchFundamentalsFor = useCallback(async (ticker) => {
    if (fundamentals[ticker] || ticker === "USD") return;
    const [dcfData, ratiosData] = await Promise.all([fetchDCF(ticker), fetchRatios(ticker)]);
    const f = {};
    if (dcfData) f.dcf = dcfData.dcf;
    if (ratiosData) {
      f.pe = ratiosData.peRatioTTM;
      f.pfcf = ratiosData.priceToFreeCashFlowsRatioTTM;
      f.de = ratiosData.debtEquityRatioTTM;
      f.gm = ratiosData.grossProfitMarginTTM;
      f.roic = ratiosData.returnOnCapitalEmployedTTM;
    }
    setFundamentals(prev => ({ ...prev, [ticker]: f }));
  }, [fundamentals]);

  // Enrich positions with live quotes
  const rows = useMemo(() => {
    return MY_POSITIONS.map(p => {
      const q = quotes[p.ticker];
      const px = q ? q.price : (p.ticker === "USD" ? p.avg : p.avg);
      const dayP = q ? q.changesPercentage || 0 : 0;
      const beta = q ? q.beta || 0 : 0;
      const eq = p.qty * px;
      const cost = p.qty * p.avg;
      const upl = eq - cost;
      const uplP = cost > 0 ? (upl / cost) * 100 : 0;
      return { ...p, px, dayP, beta, eq, cost, upl, uplP };
    });
  }, [quotes]);

  const totalEq = rows.reduce((s, r) => s + r.eq, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const dayPl = rows.reduce((s, r) => s + r.eq * (r.dayP / 100), 0);
  const dayPlP = totalEq > 0 ? (dayPl / totalEq) * 100 : 0;
  const portBeta = totalEq > 0 ? rows.reduce((s, r) => s + (r.eq / totalEq) * (r.beta || 0), 0) : 0;

  const sectorBreakdown = useMemo(() => {
    const m = {};
    rows.forEach(r => { m[r.sector] = (m[r.sector] || 0) + r.eq; });
    return Object.entries(m).map(([k, v]) => ({ sector: k, eq: v, pct: (v/totalEq)*100 }))
                 .sort((a, b) => b.eq - a.eq);
  }, [rows, totalEq]);

  const onHover = useCallback((ticker, anchor) => {
    setHover({ ticker, anchor });
    fetchFundamentalsFor(ticker);
  }, [fetchFundamentalsFor]);
  const onLeave = useCallback(() => setHover(null), []);

  if (loading) return <LoadingScreen />;

  return (
    <div className="app">
      <CommandBar rows={rows} totalEq={totalEq} totalCost={totalCost} dayPl={dayPl} dayPlP={dayPlP} portBeta={portBeta} sectorBreakdown={sectorBreakdown} />
      <SubBar dataStatus={dataStatus} rows={rows} lastSync={lastSync} />
      <div className="main">
        <div className="pane">
          <div className="pane-hdr">
            <span>01</span><span className="num">·</span>
            CROSS-BROKER INVENTORY
            <div className="right">
              <span className="tab on">All</span>
              {[...new Set(rows.map(r => r.broker))].map(b => (
                <span key={b} className="tab">{b}</span>
              ))}
              <span className="src">NORMALIZED</span>
            </div>
          </div>
          <div className="pane-body">
            <InventoryTable rows={rows} totalEq={totalEq} portBeta={portBeta} dayPlP={dayPlP}
                            onHover={onHover} onLeave={onLeave} onSelect={setSelected} selected={selected} />
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
            <Treemap rows={rows} onHover={onHover} onLeave={onLeave} mode={heatMode} />
          </div>
        </div>
        <IntelFeed news={news} />
      </div>
      <div className="bottom">
        <MacroChart rows={rows} totalEq={totalEq} />
        <SecTracker filings={filings} />
      </div>
      <StatusBar hovered={hover?.ticker || selected} />
      <InsightPopover ticker={hover?.ticker} anchor={hover?.anchor} rows={rows} fundamentals={fundamentals} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
