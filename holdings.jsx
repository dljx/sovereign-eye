// Sovereign Eye — Holdings panels (Inventory + Heatmap)

const { useState, useMemo, useEffect, useRef, useCallback } = React;

// ── Helpers (exported to window for use in other components) ──────────────

const fmtNum = (n, d = 2) =>
  n == null || isNaN(n) ? "—" :
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtMoney = (n, d = 2) =>
  n == null || isNaN(n) ? "—" :
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtPct = (n, d = 2) =>
  n == null || isNaN(n) ? "—" :
  (n >= 0 ? "+" : "") + n.toFixed(d) + "%";

const fmtCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
};

const pnlClass = (n) => n > 0 ? "inv-pos" : n < 0 ? "inv-neg" : "inv-muted";

// ── Panel shell (shared by all rows) ──────────────────────────────────────

function Panel({ idx, title, meta, headRight, children }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title"><span className="idx">{idx}</span>{title}</div>
        <div className="spacer"></div>
        {meta && <div className="meta">{meta}</div>}
        {headRight}
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

// ── HoldingsInventory ──────────────────────────────────────────────────────

function HoldingsInventory({ rows, totals, selectedTicker, onSelectTicker, hoveredTicker, onHoverTicker }) {
  const [sortKey, setSortKey] = useState("weight");
  const [sortDir, setSortDir] = useState("desc");

  const handleSort = (k) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av - bv) : (bv - av);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const Th = ({ k, children, left }) => (
    <th className={left ? "left" : ""} onClick={() => handleSort(k)}>
      {children}
      {sortKey === k && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <Panel idx="01" title="Holdings Inventory"
      meta={<span>{rows.length} POS · {sorted.filter(r => r.broker === "Tiger").length} TIGER · {sorted.filter(r => r.broker === "IBKR").length} IBKR</span>}>
      <table className="inventory">
        <thead>
          <tr>
            <Th k="ticker" left>Ticker</Th>
            <Th k="name" left>Name</Th>
            <Th k="broker" left>Broker</Th>
            <Th k="qty">Qty</Th>
            <Th k="avg">Avg Cost</Th>
            <Th k="last">Last</Th>
            <Th k="dayPct">Day Δ%</Th>
            <Th k="pnl">P&amp;L $</Th>
            <Th k="pnlPct">P&amp;L %</Th>
            <Th k="weight">Wt %</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const cls =
              (r.ticker === selectedTicker ? " selected" : "") +
              (r.ticker === hoveredTicker && r.ticker !== selectedTicker ? " hovered" : "");
            return (
              <tr key={r.ticker}
                  className={cls}
                  onClick={() => onSelectTicker(r.ticker)}
                  onMouseEnter={() => onHoverTicker(r.ticker)}
                  onMouseLeave={() => onHoverTicker(null)}>
                <td className="left"><span className="inv-ticker">{r.ticker}</span></td>
                <td className="left inv-name" title={r.name}>{r.name}</td>
                <td className="left inv-muted">
                  <span className={"dot " + (r.broker === "Tiger" ? "dot-tiger" : "dot-ibkr")}></span>
                  {r.broker}
                </td>
                <td>{fmtNum(r.qty, 0)}</td>
                <td className="inv-muted">{fmtNum(r.avg)}</td>
                <td>{fmtNum(r.last)}</td>
                <td className={pnlClass(r.dayPct)}>{fmtPct(r.dayPct)}</td>
                <td className={pnlClass(r.pnl)}>{fmtMoney(r.pnl, 0)}</td>
                <td className={pnlClass(r.pnlPct)}>{fmtPct(r.pnlPct)}</td>
                <td className="inv-muted">{fmtNum(r.weight)}%</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="inv-footer">
          <tr>
            <td className="left" colSpan="5">TOTAL · NLV</td>
            <td>{fmtMoney(totals.nlv, 0)}</td>
            <td className={pnlClass(totals.dayPct)}>{fmtPct(totals.dayPct)}</td>
            <td className={pnlClass(totals.pnl)}>{fmtMoney(totals.pnl, 0)}</td>
            <td className={pnlClass(totals.pnlPct)}>{fmtPct(totals.pnlPct)}</td>
            <td>100.00%</td>
          </tr>
        </tfoot>
      </table>
    </Panel>
  );
}

// ── HoldingsHeatmap (squarified treemap) ──────────────────────────────────

function squarify(items, x, y, w, h) {
  const rects = [];
  if (!items.length || w <= 0 || h <= 0) return rects;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return rects;

  const scale = (w * h) / total;
  const scaled = items.map(i => ({ ...i, area: i.value * scale }));

  const worstRatio = (row, shortSide) => {
    let sum = 0, max = 0, min = Infinity;
    for (const r of row) {
      sum += r.area;
      if (r.area > max) max = r.area;
      if (r.area < min) min = r.area;
    }
    const s2 = shortSide * shortSide, sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  };

  const layoutRow = (row, x, y, w, h) => {
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      const rowW = sum / h; let cy = y;
      for (const r of row) { const rh = r.area / rowW; rects.push({ key: r.key, data: r.data, x, y: cy, w: rowW, h: rh }); cy += rh; }
      return { x: x + rowW, y, w: w - rowW, h };
    } else {
      const rowH = sum / w; let cx = x;
      for (const r of row) { const rw = r.area / rowH; rects.push({ key: r.key, data: r.data, x: cx, y, w: rw, h: rowH }); cx += rw; }
      return { x, y: y + rowH, w, h: h - rowH };
    }
  };

  const place = (items, x, y, w, h) => {
    if (!items.length || w <= 0 || h <= 0) return;
    if (items.length === 1) { rects.push({ key: items[0].key, data: items[0].data, x, y, w, h }); return; }
    const shortSide = Math.min(w, h);
    let row = [items[0]], bestRatio = worstRatio(row, shortSide), i = 1;
    while (i < items.length) {
      const candidate = [...row, items[i]];
      const ratio = worstRatio(candidate, shortSide);
      if (ratio <= bestRatio) { row = candidate; bestRatio = ratio; i++; } else break;
    }
    const remaining = layoutRow(row, x, y, w, h);
    place(items.slice(i), remaining.x, remaining.y, remaining.w, remaining.h);
  };

  place(scaled, x, y, w, h);
  return rects;
}

function heatColor(pct) {
  const clamp = Math.max(-3, Math.min(3, pct));
  if (clamp >= 0) {
    const t = clamp / 3;
    return `rgb(${Math.round(28 + (40 - 28) * (1 - t))}, ${Math.round(80 + 110 * t)}, ${Math.round(50 + 60 * t)})`;
  } else {
    const t = -clamp / 3;
    return `rgb(${Math.round(90 + 110 * t)}, ${Math.round(30 + 20 * (1 - t))}, ${Math.round(40 + 20 * (1 - t))})`;
  }
}

function HoldingsHeatmap({ rows, hoveredTicker, onHoverTicker, onSelectTicker }) {
  const [mode, setMode] = useState("day");
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 400, h: 300 });
  const [pop, setPop] = useState(null);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const b = el.getBoundingClientRect();
      setSize({ w: b.width - 12, h: b.height - 12 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(() => {
    if (mode === "day") {
      const items = rows.map(r => ({ key: r.ticker, value: r.weight, data: r })).sort((a, b) => b.value - a.value);
      return squarify(items, 0, 0, size.w, size.h);
    }
    const grouped = {};
    for (const r of rows) (grouped[r.sector] = grouped[r.sector] || []).push(r);
    const sectors = Object.entries(grouped)
      .map(([s, list]) => ({ sector: s, list, value: list.reduce((a, b) => a + b.weight, 0) }))
      .sort((a, b) => b.value - a.value);
    const sectorRects = squarify(sectors.map(s => ({ key: s.sector, value: s.value, data: s })), 0, 0, size.w, size.h);
    const out = [];
    for (const sr of sectorRects) {
      const inner = squarify(
        sr.data.list.map(r => ({ key: r.ticker, value: r.weight, data: r })).sort((a, b) => b.value - a.value),
        sr.x, sr.y, sr.w, sr.h
      );
      for (const i of inner) out.push({ ...i, sectorRect: sr });
    }
    return out;
  }, [rows, mode, size]);

  const handleMove = (e, t) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPop({ ticker: t.data.ticker, x: rect.left + rect.width / 2, y: rect.top - 6, data: t.data });
    onHoverTicker(t.data.ticker);
  };

  return (
    <Panel idx="02" title="Holdings Heatmap"
      headRight={
        <div className="tabs">
          <div className={"tab" + (mode === "day" ? " active" : "")} onClick={() => setMode("day")}>Day Δ</div>
          <div className={"tab" + (mode === "sector" ? " active" : "")} onClick={() => setMode("sector")}>Sector</div>
        </div>
      }>
      <div className="heatmap-wrap" ref={wrapRef}>
        <div className="heatmap" style={{ width: size.w, height: size.h }}>
          {tiles.map(t => {
            const area = t.w * t.h;
            const sizeClass = area < 1800 ? " tiny" : area < 5000 ? " small" : "";
            return (
              <div key={t.key}
                   className={"heat-tile" + sizeClass}
                   style={{
                     left: t.x, top: t.y, width: t.w, height: t.h,
                     background: heatColor(t.data.dayPct ?? 0),
                     outline: hoveredTicker === t.key ? "1px solid var(--fg-0)" : undefined
                   }}
                   onMouseMove={(e) => handleMove(e, t)}
                   onMouseLeave={() => { setPop(null); onHoverTicker(null); }}
                   onClick={() => onSelectTicker(t.data.ticker)}>
                <div className="ht-tk">{t.data.ticker}</div>
                <div className="ht-pct">{fmtPct(t.data.dayPct, 1)}</div>
              </div>
            );
          })}
        </div>
        {pop && (
          <div className="popover" style={{
            left: Math.min(window.innerWidth - 220, Math.max(8, pop.x - 100)),
            top: Math.max(8, pop.y - 130)
          }}>
            <div className="pop-tk">{pop.data.ticker} · {pop.data.sector}</div>
            <div className="pop-row"><span>Last</span><span>{fmtNum(pop.data.last)}</span></div>
            <div className="pop-row"><span>Day Δ%</span><span className={pnlClass(pop.data.dayPct)}>{fmtPct(pop.data.dayPct)}</span></div>
            <div className="pop-row"><span>PE</span><span>{pop.data.pe ? fmtNum(pop.data.pe, 1) : "—"}</span></div>
            <div className="pop-row"><span>EPS</span><span>{pop.data.eps ? fmtNum(pop.data.eps) : "—"}</span></div>
            <div className="pop-row"><span>Target</span><span>{pop.data.target ? fmtNum(pop.data.target) : "—"}</span></div>
            <div className="pop-row"><span>Weight</span><span>{fmtNum(pop.data.weight)}%</span></div>
            <div className="pop-row"><span>P&amp;L</span><span className={pnlClass(pop.data.pnl)}>{fmtMoney(pop.data.pnl, 0)}</span></div>
          </div>
        )}
      </div>
    </Panel>
  );
}

Object.assign(window, {
  Panel,
  HoldingsInventory,
  HoldingsHeatmap,
  fmtNum, fmtMoney, fmtPct, fmtCompact, pnlClass
});
