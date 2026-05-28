/* global React, window */
(function () {
const { useState, useEffect, useMemo, useRef, useCallback } = React;

window.__CCY = window.__CCY || { ccy: 'USD', rate: 1, sym: '$' };
const CCY_RATES = { USD: 1, SGD: 1.347 };
const CCY_SYMS  = { USD: '$', SGD: 'S$' };

const fmtUSD = (n, dec = 2) => {
  if (n == null) return '—';
  const v = n * (window.__CCY?.rate ?? 1);
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const fmtUSDC = (n) => {
  if (n == null) return '—';
  const v = n * (window.__CCY?.rate ?? 1);
  const sym = window.__CCY?.sym ?? '$';
  return sym + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtMoney = (n, dec = 0) => {
  if (n == null) return '—';
  const v = n * (window.__CCY?.rate ?? 1);
  const sym = window.__CCY?.sym ?? '$';
  return sym + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const fmtPct = (n, dec = 2) => (n >= 0 ? '+' : '') + n.toFixed(dec) + '%';
const fmtAbs = (n, dec = 2) => (n >= 0 ? '+' : '') + n.toFixed(dec);
const fmtVol = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return n.toString();
};
const sign = (n) => n >= 0 ? 'pos' : 'neg';

// Normalize Finnhub quote format {c,dp,d,v} to design format {px,dPct,dAbs,vol}
const normQ = (q) => {
  if (!q) return { px: 0, dPct: 0, dAbs: 0, vol: 0 };
  return {
    px:   q.c   != null ? q.c   : (q.px   ?? 0),
    dPct: q.dp  != null ? q.dp  : (q.dPct ?? 0),
    dAbs: q.d   != null ? q.d   : (q.dAbs ?? 0),
    vol:  q.v   != null ? q.v   : (q.vol  ?? 0),
  };
};

function Icon({ name, size = 16 }) {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'square', strokeLinejoin: 'miter' };
  const paths = {
    dashboard:   <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
    holdings:    <><rect x="3" y="4" width="18" height="16" /><path d="M3 9h18M9 4v16" /></>,
    intel:       <><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M5 19l3-3" /><circle cx="12" cy="12" r="3" /></>,
    research:    <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
    scout:       <><path d="M3 21l4-10 8-3 6 6-3 8-10 4z" /><circle cx="14" cy="10" r="1.5" /></>,
    filings:     <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" /></>,
    settings:    <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.07a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09c0 .67.41 1.27 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.24.59.84 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    upload:      <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>,
    image:       <><rect x="3" y="3" width="18" height="18" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
    search:      <><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></>,
    refresh:     <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
    bell:        <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
    chevron:     <><path d="m9 18 6-6-6-6" /></>,
    chevronDown: <><path d="m6 9 6 6 6-6" /></>,
    play:        <><path d="m6 4 14 8L6 20z" /></>,
    close:       <><path d="M18 6 6 18M6 6l12 12" /></>,
    plus:        <><path d="M12 5v14M5 12h14" /></>,
    download:    <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
    home:        <><path d="m3 12 9-9 9 9" /><path d="M5 10v10h14V10" /></>,
    file:        <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    user:        <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    arrowRight:  <><path d="M5 12h14M13 5l7 7-7 7" /></>,
    arrowUp:     <><path d="M5 12 12 5 19 12M12 5v15" /></>,
    arrowDown:   <><path d="M5 12 12 19 19 12M12 19V4" /></>,
    activity:    <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    grid:        <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
    eye:         <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
    target:      <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  };
  return <svg {...props}>{paths[name] || null}</svg>;
}

function SrcPill({ src = 'live', age }) {
  const label = { live: 'LIVE', cached: 'CACHED', seed: 'SEED', error: 'ERROR' }[src] || 'LIVE';
  return (
    <span className={`src-pill ${src}`}>
      <span className="led" />
      <span>{label}</span>
      {age && <span style={{ opacity: 0.6, marginLeft: 4 }}>· {age}</span>}
    </span>
  );
}

function Sparkline({ data, w = 60, h = 18, stroke, fill, baseline = false }) {
  if (!data || !data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const last = data[data.length - 1], first = data[0];
  const c = stroke || (last >= first ? 'var(--pos)' : 'var(--neg)');
  const f = fill || (last >= first ? 'color-mix(in srgb, var(--pos) 18%, transparent)' : 'color-mix(in srgb, var(--neg) 18%, transparent)');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {baseline && <path d={`${d} L${w},${h} L0,${h} Z`} fill={f} />}
      <path d={d} stroke={c} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function heatColor(pct) {
  const p = Math.max(-5, Math.min(5, pct));
  const intensity = Math.abs(p) / 5;
  if (p >= 0) {
    const l = 18 + intensity * 28;
    return `oklch(${l}% 0.16 145)`;
  } else {
    const l = 22 + intensity * 24;
    return `oklch(${l}% 0.17 25)`;
  }
}

const PALETTE = {
  skin: '#e8b89e', skinDark: '#b88c70', hair: '#3a2a1f',
  bgGray: '#27272a', bg2: '#1f1f23', acc: '#a78bfa',
  pos: '#4ade80', neg: '#f87171', warn: '#fbbf24',
  white: '#fafafa', mid: '#71717a',
};

function AgentPixel({ kind = 'valuation', talking = false }) {
  const cfg = {
    valuation:        { hair: '#3a2a1f', outfit: '#3f3f46', acc: PALETTE.warn,  glasses: true,  type: 'tie' },
    macro:            { hair: '#5a4a3a', outfit: '#27272a', acc: PALETTE.acc,   glasses: false, type: 'scarf' },
    techanalysis:     { hair: '#1a1a1a', outfit: '#18181b', acc: PALETTE.pos,   glasses: true,  type: 'visor' },
    fundforensics:    { hair: '#7a6a4a', outfit: '#3f3f46', acc: PALETTE.neg,   glasses: true,  type: 'mag' },
    marketstructure:  { hair: '#2a2a3a', outfit: '#27272a', acc: '#60a5fa',     glasses: false, type: 'headset' },
  };
  const c = cfg[kind] || cfg.valuation;
  const rows = Array.from({ length: 16 }, () => Array(16).fill(null));
  const set = (x, y, color) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) rows[y][x] = color; };
  for (let y = 3; y <= 8; y++) for (let x = 5; x <= 10; x++) set(x, y, PALETTE.skin);
  for (let x = 4; x <= 11; x++) set(x, 2, c.hair);
  for (let x = 5; x <= 10; x++) set(x, 3, c.hair);
  set(4, 3, c.hair); set(11, 3, c.hair);
  set(4, 4, c.hair); set(11, 4, c.hair);
  set(6, 5, '#0d0d10'); set(9, 5, '#0d0d10');
  if (talking) { set(7, 7, c.acc); set(8, 7, c.acc); }
  else { set(7, 7, PALETTE.skinDark); set(8, 7, PALETTE.skinDark); }
  set(7, 9, PALETTE.skinDark); set(8, 9, PALETTE.skinDark);
  for (let y = 10; y <= 15; y++) for (let x = 4; x <= 11; x++) set(x, y, c.outfit);
  set(7, 10, c.acc); set(8, 10, c.acc);
  for (let y = 10; y <= 13; y++) { set(3, y, c.outfit); set(12, y, c.outfit); }
  if (c.glasses) {
    set(5, 5, c.acc); set(6, 5, c.acc);
    set(9, 5, c.acc); set(10, 5, c.acc);
    set(7, 5, c.acc); set(8, 5, c.acc);
  }
  if (c.type === 'tie') {
    set(7, 11, c.acc); set(8, 11, c.acc);
    set(7, 12, c.acc); set(8, 12, c.acc);
    set(7, 13, c.acc);
  }
  if (c.type === 'visor') {
    for (let x = 4; x <= 11; x++) set(x, 4, c.acc);
    for (let x = 4; x <= 11; x++) set(x, 5, '#0d0d10');
  }
  if (c.type === 'mag') {
    set(2, 12, c.acc); set(2, 13, c.acc); set(1, 12, c.acc); set(1, 13, c.acc);
  }
  if (c.type === 'headset') {
    set(4, 3, c.acc); set(11, 3, c.acc);
    set(3, 4, c.acc); set(12, 4, c.acc);
    set(3, 5, c.acc);
  }
  if (c.type === 'scarf') {
    for (let x = 5; x <= 10; x++) set(x, 9, c.acc);
    set(4, 10, c.acc); set(11, 10, c.acc);
  }
  const cell = 3.5;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" shapeRendering="crispEdges">
      <rect x="0" y="0" width="56" height="56" fill={PALETTE.bg2} />
      {rows.map((row, y) =>
        row.map((color, x) => color ? (
          <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.5} height={cell + 0.5} fill={color} />
        ) : null)
      )}
    </svg>
  );
}

function MacroChart({ nav, spx, w = 360, h = 180 }) {
  const padL = 28, padR = 8, padT = 8, padB = 18;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const all = [...(nav||[]), ...(spx||[])];
  if (!all.length) return null;
  const min = Math.min(...all), max = Math.max(...all);
  const range = max - min || 1;
  const points = (arr) =>
    (arr||[]).map((v, i) => {
      const x = padL + (i / Math.max(arr.length - 1, 1)) * innerW;
      const y = padT + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  const gridLines = 4;
  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => {
    const y = padT + (i / gridLines) * innerH;
    const val = max - (i / gridLines) * range;
    return { y, val };
  });

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y} x2={w - padR} y2={t.y} stroke="var(--border-1)" />
          <text x={padL - 6} y={t.y + 3} textAnchor="end" fontSize="9" fontFamily="JetBrains Mono" fill="var(--fg-4)">
            {t.val.toFixed(0)}
          </text>
        </g>
      ))}
      {spx && <path d={points(spx)} stroke="var(--fg-3)" strokeWidth="1.25" fill="none" />}
      {nav && <path d={points(nav)} stroke="var(--acc)" strokeWidth="1.75" fill="none" />}
      {nav && nav.length > 0 && (() => {
        const i = nav.length - 1;
        const x = padL + innerW;
        const y = padT + innerH - ((nav[i] - min) / range) * innerH;
        return <circle cx={x} cy={y} r="2.5" fill="var(--acc)" />;
      })()}
    </svg>
  );
}

function Treemap({ items, width, height }) {
  // Only tiles with a real positive weight can be laid out. Dropping zero/NaN
  // weights (e.g. a holding with no live price) prevents divide-by-zero →
  // NaN tile dimensions, which previously broke the whole heatmap render.
  const valid = (items || []).filter(x => x && x.weight > 0 && isFinite(x.weight));
  const total = valid.reduce((s, x) => s + x.weight, 0);
  if (!total || !width || !height) return <div className="heatmap" style={{ width, height, background: 'var(--bg-0)' }} />;
  const sorted = [...valid].sort((a, b) => b.weight - a.weight);
  const tiles = [];

  function layout(arr, x, y, w, h, horizontal) {
    if (arr.length === 0) return;
    if (arr.length === 1) { tiles.push({ ...arr[0], x, y, w, h }); return; }
    const sum = arr.reduce((s, a) => s + a.weight, 0);
    if (sum <= 0) return;
    let take = 1, cum = arr[0].weight;
    while (take < arr.length - 1 && cum < sum / 2) { cum += arr[take].weight; take++; }
    const a = arr.slice(0, take), b = arr.slice(take);
    const aSum = a.reduce((s, x) => s + x.weight, 0);
    if (horizontal) {
      const aw = w * (aSum / sum);
      layoutStrip(a, x, y, aw, h, false);
      layout(b, x + aw, y, w - aw, h, !horizontal);
    } else {
      const ah = h * (aSum / sum);
      layoutStrip(a, x, y, w, ah, true);
      layout(b, x, y + ah, w, h - ah, !horizontal);
    }
  }
  function layoutStrip(arr, x, y, w, h, horizontal) {
    const sum = arr.reduce((s, x) => s + x.weight, 0);
    if (sum <= 0) return;
    let off = 0;
    arr.forEach(item => {
      const portion = item.weight / sum;
      if (horizontal) {
        const cw = w * portion;
        tiles.push({ ...item, x: x + off, y, w: cw, h });
        off += cw;
      } else {
        const ch = h * portion;
        tiles.push({ ...item, x, y: y + off, w, h: ch });
        off += ch;
      }
    });
  }

  layout(sorted, 0, 0, width, height, width > height);

  return (
    <div className="heatmap" style={{ width, height, position: 'relative', background: 'var(--bg-0)' }}>
      {tiles.map((t) => {
        const sizeClass = t.w * t.h < 4000 ? 'small' : (t.w * t.h < 9000 ? 'medium' : '');
        return (
          <div key={t.tk} className="heatmap-tile"
            title={`${t.tk} ${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(2)}%`}
            style={{ position: 'absolute', left: t.x + 1, top: t.y + 1, width: t.w - 2, height: t.h - 2, background: heatColor(t.pct) }}>
            <div>
              <div className={`hm-tk ${sizeClass}`}>{t.tk}</div>
              {t.w * t.h > 6000 && <div className="hm-nm">{t.name}</div>}
            </div>
            <div className={`hm-pct ${sizeClass}`}>{t.pct >= 0 ? '+' : ''}{t.pct.toFixed(2)}%</div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  fmtUSD, fmtUSDC, fmtMoney, fmtPct, fmtAbs, fmtVol, sign, normQ,
  CCY_RATES, CCY_SYMS,
  Icon, SrcPill, Sparkline, heatColor, AgentPixel, MacroChart, Treemap,
});
})();
