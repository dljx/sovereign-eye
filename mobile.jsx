// Sovereign Eye — Mobile v2
// 5-screen mobile portfolio terminal — designed by Claude Design, implemented in code.
// Entry: mobile.html → loads positions.js + seed.js → this file → ReactDOM.createRoot

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// Rename everything to avoid clashing with const declarations in positions.js
const M_POSITIONS  = window.SE_CONFIG.MY_POSITIONS;
const M_CONFIG     = window.SE_CONFIG.CONFIG;
const M_SYNTHESIS  = window.SE_CONFIG.SYNTHESIS;
const M_SEC_SEED   = window.SE_CONFIG.SEC_SEED;
const M_NEWS_SEED  = window.SE_CONFIG.NEWS_SEED;

// ── Design tokens ──────────────────────────────────────────────────────────────
const SE = {
  bg0: '#09090b', bg1: '#0d0d10', bg2: '#111114', bg3: '#17171b',
  b1: '#1f1f25', b2: '#27272e',
  fg0: '#f4f4f5', fg1: '#d4d4d8', fg2: '#a1a1aa', fg3: '#71717a',
  green: '#4ade80', red: '#f87171', amber: '#fbbf24', blue: '#60a5fa', indigo: '#818cf8',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
  sans: 'Inter, -apple-system, system-ui, sans-serif',
};

// ── DD helpers ─────────────────────────────────────────────────────────────────
function extractDD(raw) {
  if (!raw) return null;
  const r = raw.result || raw;
  if (r.consensus_score == null && r.score == null) return null;
  return {
    score:      +(r.consensus_score ?? r.score ?? 0).toFixed(2),
    grade:      (r.consensus_grade ?? r.grade ?? 'HOLD').trim().toUpperCase(),
    confidence: r.confidence ?? 'MEDIUM',
    thesis:     r.majority_thesis ?? r.thesis ?? '',
    swing:      r.key_swing_factor ?? '',
    dissent:    r.dissent ?? '',
    agentScores: r.agent_final_scores ?? {},
    loops:      r.loops_run ?? 0,
    converged:  r.converged ?? false,
  };
}

function ddGradeColor(grade) {
  if (!grade) return SE.fg3;
  const g = grade.toUpperCase();
  if (g === 'STRONG BUY' || g === 'BUY')   return SE.green;
  if (g === 'STRONG SELL' || g === 'SELL') return SE.red;
  return SE.fg3;
}

function ddGradeAbbr(grade) {
  if (!grade) return '?';
  switch (grade.toUpperCase()) {
    case 'STRONG BUY':  return 'SB';
    case 'BUY':         return 'B';
    case 'HOLD':        return 'H';
    case 'SELL':        return 'S';
    case 'STRONG SELL': return 'SS';
    default:            return grade.charAt(0);
  }
}

function DDGradeBadge({ grade, large = false }) {
  const color = ddGradeColor(grade);
  const bg    = color === SE.fg3 ? SE.bg3 : color + '22';
  return (
    <span style={{
      fontFamily: SE.mono, fontSize: large ? 9 : 7, fontWeight: 700,
      letterSpacing: large ? 1 : 0.8, color,
      background: bg, padding: large ? '2px 6px' : '1px 4px',
      lineHeight: 1, flexShrink: 0,
    }}>
      {large ? grade : ddGradeAbbr(grade)}
    </span>
  );
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const money = (n, dp = 2) => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct   = (n, dp = 2) => (+n || 0).toFixed(dp) + '%';
const fmt = { money, pct, shares: n => (+n || 0).toLocaleString('en-US') };

// ── Time / session helpers ─────────────────────────────────────────────────────
function getSession() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  if (d === 0 || d === 6) return 'CLOSED';
  if (m < 240) return 'CLOSED';
  if (m < 570) return 'PRE-MKT';
  if (m < 960) return 'OPEN';
  if (m < 1200) return 'AFTER-HRS';
  return 'CLOSED';
}

function sgtNow() {
  const d = new Date();
  return {
    time: d.toLocaleTimeString('en-US', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false }),
    date: d.toLocaleDateString('en-US', { timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(),
  };
}

function timeAgo(ts) {
  const diff = Date.now() - (ts > 1e12 ? ts : ts * 1000);
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Network helpers ────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchQuotes(tickers, key) {
  if (!key || !tickers.length) return {};
  const map = {};
  for (const t of tickers.filter(t => t !== 'USD')) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${key}`);
      if (r.ok) { const q = await r.json(); if (q?.c > 0) map[t] = { price: q.c, dPct: q.dp || 0 }; }
    } catch (e) {}
    await delay(120);
  }
  return map;
}

async function fetchSGD() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD');
    if (r.ok) { const d = await r.json(); if (d?.rates?.SGD) return d.rates.SGD; }
  } catch (e) {}
  return 1.35;
}

async function fetchFinnhubNews(tickers, key) {
  if (!key) return [];
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const sym of tickers.slice(0, 5)) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${weekAgo}&to=${today}&token=${key}`);
      if (r.ok) { const d = await r.json(); if (Array.isArray(d)) d.slice(0, 3).forEach(n => out.push({ ...n, sym })); }
    } catch (e) {}
    await delay(120);
  }
  return out.sort((a, b) => (b.datetime || 0) - (a.datetime || 0)).slice(0, 15);
}

async function fetchSynthesis(tickers) {
  try {
    const r = await fetch(`/api/synthesis?tickers=${tickers.join(',')}`);
    if (r.ok) return await r.json();
  } catch (e) {}
  return null;
}

async function fetchScoutResults() {
  try {
    const r = await fetch('/api/scout-results');
    if (r.ok) return await r.json();
  } catch (e) {}
  return null;
}

// ── KV position sync ───────────────────────────────────────────────────────────
const STORAGE_KEY = 'se-positions-v1';

async function kvLoad() {
  try { const r = await fetch('/api/positions'); if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) return d; } } catch (e) {}
  return null;
}

async function kvSave(positions) {
  try { await fetch('/api/positions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(positions) }); } catch (e) {}
}

async function loadPositions() {
  const kv = await kvLoad();
  if (kv) return kv;
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) return p; } } catch (e) {}
  return M_POSITIONS;
}

// ── Data enrichment ────────────────────────────────────────────────────────────
function enrichPositions(positions, quotes, sgd) {
  return positions
    .filter(p => p.ticker !== 'USD')
    .map(p => {
      const q = quotes[p.ticker] || {};
      const px = q.price || p.avg;
      const dPct = q.dPct || 0;
      const sh = +p.qty;
      const cost = +p.avg;
      const value = sh * px;
      const costBasis = sh * cost;
      const trend = dPct > 0.1 ? 'up' : dPct < -0.1 ? 'down' : 'flat';
      return { t: p.ticker, name: p.name || p.ticker, sh, px, dPct, cost, value, costBasis, trend, sector: p.sector, beta: p.beta || 1 };
    })
    .sort((a, b) => b.value - a.value);
}

function buildPortfolioSummary(enriched, sgd) {
  const totalUSD = enriched.reduce((s, p) => s + p.value, 0);
  const costBasis = enriched.reduce((s, p) => s + p.costBasis, 0);
  const dayPnlUSD = enriched.reduce((s, p) => s + p.sh * p.px * (p.dPct / 100), 0);
  return {
    totalUSD, totalSGD: totalUSD * sgd,
    dayPnlUSD, dayPnlPct: totalUSD > 0 ? (dayPnlUSD / (totalUSD - dayPnlUSD)) * 100 : 0,
    totalPnlUSD: totalUSD - costBasis,
    totalPnlPct: costBasis > 0 ? ((totalUSD - costBasis) / costBasis) * 100 : 0,
    costBasisUSD: costBasis,
  };
}

// ── Shared atoms ───────────────────────────────────────────────────────────────

function SEPhone({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%', maxWidth: 430, background: SE.bg0,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: SE.sans, color: SE.fg0, WebkitFontSmoothing: 'antialiased',
    }}>{children}</div>
  );
}

function SEAppHeader({ session, sgt, sub }) {
  const sc = { OPEN: SE.green, 'PRE-MKT': SE.amber, 'AFTER-HRS': SE.amber, CLOSED: SE.red }[session] || SE.fg2;
  return (
    <div style={{
      padding: '12px 16px', borderBottom: `1px solid ${SE.b1}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: SE.bg0, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M0.8 8 C 3 3.2, 13 3.2, 15.2 8 C 13 12.8, 3 12.8, 0.8 8 Z" stroke={SE.indigo} strokeWidth="1.2" strokeLinejoin="round"/>
          <circle cx="8" cy="8" r="2.1" fill={SE.indigo}/>
        </svg>
        <span style={{ fontFamily: SE.mono, fontSize: 11, fontWeight: 700, color: SE.fg0, letterSpacing: 1.8 }}>SOVEREIGN EYE</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 7px 3px 6px', background: `${sc}1a`,
          border: `1px solid ${sc}33`, borderRadius: 3,
          fontFamily: SE.mono, fontSize: 9, fontWeight: 700, letterSpacing: 1, color: sc,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc,
            boxShadow: session === 'OPEN' ? `0 0 6px ${sc}` : 'none' }}/>
          {session}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: SE.mono, fontSize: 11, color: SE.fg1, fontVariantNumeric: 'tabular-nums' }}>{sgt} SGT</div>
          <div style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 0.6, marginTop: 1 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

function SEBottomNav({ active, onNavigate }) {
  const c = k => k === active ? SE.fg0 : SE.fg3;
  const items = [
    { k: 'portfolio', label: 'PORTFOLIO', icon: k => (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1.5" y="3" width="15" height="11" rx="0.5" stroke={c(k)} strokeWidth="1.4"/>
        <path d="M5.5 11 L8 8 L10.5 10 L13.5 6" stroke={c(k)} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { k: 'intel', label: 'INTEL', icon: k => (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M2 4h14M2 8h10M2 12h12" stroke={c(k)} strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="15" cy="8" r="1.5" fill={c(k)}/>
      </svg>
    )},
    { k: 'scout', label: 'SCOUT', icon: k => (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke={c(k)} strokeWidth="1.4"/>
        <path d="M12 12 L16 16" stroke={c(k)} strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="8" cy="8" r="1.3" fill={c(k)}/>
      </svg>
    )},
    { k: 'settings', label: 'CONFIG', icon: k => (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 5h12M3 9h12M3 13h12" stroke={c(k)} strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="6" cy="5" r="1.6" fill={SE.bg0} stroke={c(k)} strokeWidth="1.4"/>
        <circle cx="11" cy="9" r="1.6" fill={SE.bg0} stroke={c(k)} strokeWidth="1.4"/>
        <circle cx="7" cy="13" r="1.6" fill={SE.bg0} stroke={c(k)} strokeWidth="1.4"/>
      </svg>
    )},
  ];
  return (
    <div style={{
      borderTop: `1px solid ${SE.b1}`, background: SE.bg1,
      padding: '8px 0 20px', display: 'flex', justifyContent: 'space-around', flexShrink: 0,
    }}>
      {items.map(it => {
        const on = it.k === active;
        return (
          <button key={it.k} onClick={() => onNavigate(it.k)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '6px 8px', minWidth: 60, color: on ? SE.fg0 : SE.fg3,
          }}>
            {it.icon(it.k)}
            <span style={{ fontFamily: SE.mono, fontSize: 9, fontWeight: 600, letterSpacing: 1.2 }}>{it.label}</span>
            <span style={{ width: 16, height: 1.5, background: on ? SE.indigo : 'transparent', marginTop: -1 }}/>
          </button>
        );
      })}
    </div>
  );
}

function SEPill({ kind, size = 'sm' }) {
  const map = {
    BULL: { fg: SE.green, bg: `${SE.green}1a`, bd: `${SE.green}33` },
    BEAR: { fg: SE.red, bg: `${SE.red}1a`, bd: `${SE.red}33` },
    NEUT: { fg: SE.fg2, bg: `${SE.fg2}1a`, bd: `${SE.fg2}33` },
    BUY: { fg: SE.green, bg: `${SE.green}1a`, bd: `${SE.green}33` },
    'STRONG BUY': { fg: SE.bg0, bg: SE.green, bd: SE.green },
    HOLD: { fg: SE.amber, bg: `${SE.amber}1a`, bd: `${SE.amber}33` },
    SELL: { fg: SE.red, bg: `${SE.red}1a`, bd: `${SE.red}33` },
  };
  const cl = map[kind] || map.NEUT;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: size === 'lg' ? '4px 8px' : '2px 6px', borderRadius: 2,
      background: cl.bg, border: `1px solid ${cl.bd}`, color: cl.fg,
      fontFamily: SE.mono, fontSize: size === 'lg' ? 10.5 : 9,
      fontWeight: 700, letterSpacing: 1, lineHeight: 1, whiteSpace: 'nowrap',
    }}>{kind}</span>
  );
}

function SENum({ value, fmt: fmtFn = v => String(v), signed = false, glow = true, weight = 600, size = 13 }) {
  const num = typeof value === 'number' ? value : parseFloat(value) || 0;
  const pos = num > 0, neg = num < 0;
  const col = pos ? SE.green : neg ? SE.red : SE.fg1;
  const txt = signed ? (pos ? '+' : '') + fmtFn(value) : fmtFn(value);
  return (
    <span style={{
      fontFamily: SE.mono, fontWeight: weight, fontSize: size, color: col,
      fontVariantNumeric: 'tabular-nums',
      textShadow: glow && pos ? `0 0 8px ${SE.green}55` : 'none',
    }}>{txt}</span>
  );
}

function SETrend({ dir = 'flat', value, width = 42, height = 14 }) {
  const seed = String(value || dir).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const slope = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
  const col = dir === 'up' ? SE.green : dir === 'down' ? SE.red : SE.fg3;
  const points = [];
  for (let i = 0; i < 7; i++) {
    const noise = ((seed >> i) & 7) - 3.5;
    const y = Math.max(2, Math.min(height - 2, (height - 3) - i * slope * 1.4 - (height / 2 - 4) + noise * 0.6));
    points.push([i * (width / 6), y]);
  }
  const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={d} stroke={col} strokeWidth="1.3" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function SESectionHeader({ label, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px 7px', flexShrink: 0 }}>
      <div style={{ fontFamily: SE.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: SE.fg3 }}>{label}</div>
      {right}
    </div>
  );
}

function SEPriceSpark({ dir, ticker }) {
  const w = 354, h = 80;
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const slope = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
  const pts = [];
  for (let i = 0; i < 60; i++) {
    const x = i * (w / 59);
    const y = Math.max(4, Math.min(h - 4,
      h * 0.5 - slope * (i / 59) * h * 0.5
      + Math.sin(i * 0.25 + seed) * 6 + Math.sin(i * 0.13 + seed * 2) * 4
      + (((seed * (i + 1)) % 13) - 6) * 1.1
    ));
    pts.push([x, y]);
  }
  const p = pts.map((pt, i) => (i === 0 ? 'M' : 'L') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ');
  const col = dir === 'up' ? SE.green : dir === 'down' ? SE.red : SE.fg2;
  const last = pts[pts.length - 1];
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`sg-${ticker}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={col} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(r => (
        <line key={r} x1="0" y1={h * r} x2={w} y2={h * r} stroke={SE.b1} strokeDasharray="2 4"/>
      ))}
      <path d={p + ` L ${w} ${h} L 0 ${h} Z`} fill={`url(#sg-${ticker})`}/>
      <path d={p} stroke={col} strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
      <circle cx={last[0] - 2} cy={last[1]} r="3" fill={col} style={{ filter: `drop-shadow(0 0 4px ${col})` }}/>
    </svg>
  );
}

// ── SCREEN 1: Portfolio ────────────────────────────────────────────────────────

function SEScreenHome({ data, onNavigate, onTapPosition }) {
  const { portfolio: p, positions, meta, ddIndex = {} } = data;
  return (
    <SEPhone>
      <SEAppHeader session={meta.session} sgt={meta.sgt} sub={meta.date}/>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Net worth hero */}
        <div style={{
          padding: '18px 16px 16px',
          background: `linear-gradient(180deg, ${SE.bg1} 0%, ${SE.bg0} 100%)`,
          borderBottom: `1px solid ${SE.b1}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: SE.mono, fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: SE.fg3 }}>NET PORTFOLIO · SGD</span>
            <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3 }}>FX {meta.fxUsdSgd.toFixed(4)}</span>
          </div>
          <div style={{ fontFamily: SE.mono, fontSize: 34, fontWeight: 700, letterSpacing: -0.5, color: SE.fg0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
            S$ {money(p.totalSGD)}
          </div>
          <div style={{ fontFamily: SE.mono, fontSize: 13, color: SE.fg2, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
            US$ {money(p.totalUSD)}
          </div>
          <div style={{ display: 'flex', marginTop: 16, borderTop: `1px solid ${SE.b1}`, paddingTop: 14 }}>
            <div style={{ flex: 1, borderRight: `1px solid ${SE.b1}`, paddingRight: 14 }}>
              <div style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600 }}>DAY P&L (USD)</div>
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <SENum value={p.dayPnlUSD} fmt={v => (v >= 0 ? '+' : '') + '$' + money(Math.abs(v))} size={16} weight={700}/>
                <SENum value={p.dayPnlPct} fmt={v => (v >= 0 ? '+' : '') + pct(Math.abs(v))} size={11} weight={600}/>
              </div>
            </div>
            <div style={{ flex: 1, paddingLeft: 14 }}>
              <div style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600 }}>TOTAL P&L</div>
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <SENum value={p.totalPnlUSD} fmt={v => (v >= 0 ? '+' : '') + '$' + money(Math.abs(v), 0)} size={16} weight={700}/>
                <SENum value={p.totalPnlPct} fmt={v => (v >= 0 ? '+' : '') + pct(Math.abs(v))} size={11} weight={600}/>
              </div>
            </div>
          </div>
        </div>

        {/* Position list */}
        <SESectionHeader label={`POSITIONS · ${positions.length}`} right={
          <span style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1 }}>VALUE ▾</span>
        }/>
        <div style={{ display: 'grid', gridTemplateColumns: '68px 1fr 62px 52px', padding: '0 16px 6px', gap: 6, fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1 }}>
          <span>TICKER</span><span>QTY · PX</span>
          <span style={{ textAlign: 'right' }}>VALUE</span>
          <span style={{ textAlign: 'right' }}>DAY%</span>
        </div>
        <div style={{ borderTop: `1px solid ${SE.b1}` }}>
          {positions.map((pos, i) => (
            <button key={pos.t + i} onClick={() => onTapPosition(pos)} style={{
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: i < positions.length - 1 ? `1px solid ${SE.b1}` : 'none',
              padding: '10px 16px', display: 'block', textAlign: 'left',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '68px 1fr 62px 52px', gap: 6, alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: SE.mono, fontSize: 13, fontWeight: 700, color: SE.fg0, letterSpacing: 0.4 }}>{pos.t}</span>
                    {ddIndex[pos.t] && <DDGradeBadge grade={ddIndex[pos.t].grade}/>}
                  </div>
                  <SETrend dir={pos.trend} value={pos.t} width={42} height={13}/>
                </div>
                <div>
                  <div style={{ fontFamily: SE.sans, fontSize: 11, color: SE.fg2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pos.name}</div>
                  <div style={{ marginTop: 2, fontFamily: SE.mono, fontSize: 10, color: SE.fg3, fontVariantNumeric: 'tabular-nums' }}>
                    {pos.sh} sh · ${money(pos.px)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: SE.mono, fontSize: 12, fontWeight: 600, color: SE.fg0, fontVariantNumeric: 'tabular-nums' }}>
                    ${money(pos.value, 0)}
                  </div>
                  <SENum value={((pos.px - pos.cost) / pos.cost) * 100} fmt={v => (v >= 0 ? '+' : '') + pct(Math.abs(v))} size={10} weight={500}/>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <SENum value={pos.dPct} fmt={v => (v >= 0 ? '+' : '') + pct(Math.abs(v))} size={12} weight={700} glow={false}/>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ height: 16 }}/>
      </div>
      <SEBottomNav active="portfolio" onNavigate={onNavigate}/>
    </SEPhone>
  );
}

// ── SCREEN 2: Intel ────────────────────────────────────────────────────────────

function SEScreenIntel({ data, onNavigate, initialTab = 'SYNTHESIS' }) {
  const [tab, setTab] = useState(initialTab);
  const tabs = ['SYNTHESIS', 'NEWS', 'SEC', 'MACRO'];
  const { meta, synthesis, news, filings } = data;

  return (
    <SEPhone>
      <SEAppHeader session={meta.session} sgt={meta.sgt} sub={meta.date}/>
      <div style={{ display: 'flex', borderBottom: `1px solid ${SE.b1}`, background: SE.bg0, flexShrink: 0 }}>
        {tabs.map(t => {
          const on = t === tab;
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: SE.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2,
              color: on ? SE.fg0 : SE.fg3,
              borderBottom: on ? `2px solid ${SE.indigo}` : '2px solid transparent',
              marginBottom: -1,
            }}>{t}</button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'SYNTHESIS' && <IntelSynthesis synthesis={synthesis}/>}
        {tab === 'NEWS' && <IntelNews news={news}/>}
        {tab === 'SEC' && <IntelSEC filings={filings}/>}
        {tab === 'MACRO' && <IntelMacro/>}
      </div>
      <SEBottomNav active="intel" onNavigate={onNavigate}/>
    </SEPhone>
  );
}

function IntelSynthesis({ synthesis }) {
  const s = synthesis || M_SYNTHESIS;
  return (
    <div>
      <div style={{
        padding: '11px 16px', background: SE.bg1, borderBottom: `1px solid ${SE.b1}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: SE.indigo, boxShadow: `0 0 6px ${SE.indigo}` }}/>
          <span style={{ fontFamily: SE.mono, fontSize: 10, fontWeight: 700, color: SE.fg1, letterSpacing: 1.2 }}>GEMINI · DAILY SYNTHESIS</span>
        </div>
        <span style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>{s.runAt || 'SEED DATA'}</span>
      </div>
      <BulletBlock label="CATALYSTS" color={SE.green} items={s.catalysts || []}/>
      <BulletBlock label="RISKS" color={SE.red} items={s.risks || []}/>
      <BulletBlock label="MACRO ALIGN" color={SE.blue} items={s.macro || []}/>
      <div style={{ height: 16 }}/>
    </div>
  );
}

function BulletBlock({ label, color, items }) {
  return (
    <div style={{ borderBottom: `1px solid ${SE.b1}` }}>
      <div style={{
        padding: '11px 16px 5px', fontFamily: SE.mono, fontSize: 10, fontWeight: 700,
        letterSpacing: 1.4, color, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}88` }}/>
        {label}
        <span style={{ marginLeft: 'auto', color: SE.fg3, fontWeight: 500 }}>{items.length}</span>
      </div>
      {items.map((it, i) => (
        <div key={i} style={{
          padding: '8px 16px 10px', display: 'flex', gap: 10,
          borderTop: i > 0 ? `1px solid ${SE.b1}` : 'none',
        }}>
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 6, boxShadow: `0 0 6px ${color}` }}/>
          <div style={{ fontFamily: SE.sans, fontSize: 12, color: SE.fg1, lineHeight: 1.5, flex: 1 }}>{it}</div>
        </div>
      ))}
    </div>
  );
}

function IntelNews({ news }) {
  if (!news || !news.length) {
    return <div style={{ padding: '32px 16px', fontFamily: SE.mono, fontSize: 11, color: SE.fg3, textAlign: 'center' }}>No live news — check back soon.</div>;
  }
  return (
    <div>
      {news.map((n, i) => {
        const sent = n.sent || (n.severity === 'warn' ? 'BEAR' : 'BULL');
        const ticker = n.ticker || n.sym || n.related || '—';
        const headline = n.headline || n.title || '';
        const ago = n.datetime ? timeAgo(n.datetime) : (n.ago || '—');
        const src = n.src || n.source || '—';
        return (
          <div key={i} style={{ padding: '11px 16px', borderBottom: `1px solid ${SE.b1}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <SEPill kind={sent}/>
              <span style={{ fontFamily: SE.mono, fontSize: 10, fontWeight: 700, color: SE.fg0, letterSpacing: 0.8 }}>{ticker}</span>
              <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3 }}>·</span>
              <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3 }}>{src}</span>
              <span style={{ marginLeft: 'auto', fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>{ago}</span>
            </div>
            {n.url
              ? <a href={n.url} target="_blank" rel="noreferrer" style={{ fontFamily: SE.sans, fontSize: 12.5, color: SE.fg1, lineHeight: 1.4, textDecoration: 'none' }}>{headline}</a>
              : <div style={{ fontFamily: SE.sans, fontSize: 12.5, color: SE.fg1, lineHeight: 1.4 }}>{headline}</div>
            }
          </div>
        );
      })}
    </div>
  );
}

function IntelSEC({ filings }) {
  const items = (filings && filings.length) ? filings : M_SEC_SEED;
  return (
    <div>
      {items.map((f, i) => {
        const ticker = f.ticker || f.t;
        const sent = f.sentiment || f.sent || 'BULL';
        const desc = f.tldr || f.desc || '';
        const form = f.form;
        const ago = f.date ? timeAgo(new Date(f.date).getTime()) : (f.ago || '—');
        return (
          <div key={i} style={{ padding: '11px 16px', borderBottom: `1px solid ${SE.b1}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <span style={{
                padding: '2px 6px', background: SE.bg3, fontFamily: SE.mono, fontSize: 9,
                fontWeight: 700, color: SE.fg1, letterSpacing: 1, borderRadius: 2,
                border: `1px solid ${SE.b2}`,
              }}>{form}</span>
              <span style={{ fontFamily: SE.mono, fontSize: 10, fontWeight: 700, color: SE.fg0, letterSpacing: 0.8 }}>{ticker}</span>
              <SEPill kind={sent === 'bull' ? 'BULL' : sent === 'bear' ? 'BEAR' : sent.toUpperCase()}/>
              <span style={{ marginLeft: 'auto', fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>{ago}</span>
            </div>
            {f.url
              ? <a href={f.url} target="_blank" rel="noreferrer" style={{ fontFamily: SE.sans, fontSize: 12, color: SE.fg1, lineHeight: 1.5, textDecoration: 'none' }}>{desc}</a>
              : <div style={{ fontFamily: SE.sans, fontSize: 12, color: SE.fg1, lineHeight: 1.5 }}>{desc}</div>
            }
          </div>
        );
      })}
    </div>
  );
}

const MACRO_CARDS = [
  { k: 'VIX',       v: '14.32', d: '-3.18%', dir: 'down', note: 'Risk-on regime' },
  { k: '10Y-2Y',    v: '+0.38%', d: '+2bps', dir: 'up',  note: 'Curve steepening' },
  { k: 'DXY',       v: '103.84', d: '-0.41%', dir: 'down', note: 'USD softening' },
  { k: 'CPI CORE',  v: '3.10%',  d: '+0.1pp', dir: 'up',  note: 'Above exp.' },
  { k: 'FED FUNDS', v: '4.25%',  d: '—',     dir: 'flat', note: 'Cut priced JUL' },
  { k: 'HY OAS',    v: '298bps', d: '-12bps', dir: 'down', note: 'Credit tightening' },
  { k: 'BTC',       v: '$97.4K', d: '+2.18%', dir: 'up',  note: 'ETF inflows +$1.2B' },
  { k: 'WTI',       v: '$71.04', d: '-1.84%', dir: 'down', note: 'OPEC+ stable' },
];

function IntelMacro() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: SE.b1 }}>
      {MACRO_CARDS.map(m => {
        const dc = m.dir === 'up' ? SE.green : m.dir === 'down' ? SE.red : SE.fg2;
        return (
          <div key={m.k} style={{ padding: '12px 14px', background: SE.bg0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontFamily: SE.mono, fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: SE.fg3 }}>{m.k}</div>
            <div style={{ fontFamily: SE.mono, fontSize: 17, fontWeight: 700, color: SE.fg0, fontVariantNumeric: 'tabular-nums' }}>{m.v}</div>
            <div style={{ fontFamily: SE.mono, fontSize: 10, color: dc, fontWeight: 600 }}>{m.d}</div>
            <div style={{ fontFamily: SE.sans, fontSize: 10, color: SE.fg3 }}>{m.note}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── SCREEN 3: Scout ────────────────────────────────────────────────────────────

function SEScreenScout({ data, onNavigate }) {
  const { scout, meta } = data;
  const signals = scout?.signals || [];
  const runAt = scout?.runAt || '—';
  const [expanded, setExpanded] = useState(signals[0]?.t || null);

  return (
    <SEPhone>
      <SEAppHeader session={meta.session} sgt={meta.sgt} sub={meta.date}/>

      <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${SE.b1}`, background: SE.bg1, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: SE.indigo, boxShadow: `0 0 8px ${SE.indigo}`, animation: 'sePulse 1.8s ease-in-out infinite' }}/>
          <div style={{ fontFamily: SE.mono, fontSize: 13, fontWeight: 700, color: SE.fg0, letterSpacing: 2 }}>SOVEREIGN SCOUT</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3 }}>LAST RUN · {runAt}</span>
          <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.green, fontWeight: 600 }}>
            {signals.length > 0 ? `${signals.length} SIGNAL${signals.length !== 1 ? 'S' : ''}` : 'HUNTING…'}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {signals.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: SE.mono, fontSize: 11, color: SE.fg3, letterSpacing: 1.4, marginBottom: 16 }}>SCOUT IS HUNTING…</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: SE.indigo, opacity: 0.6,
                  animation: `sePulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                }}/>
              ))}
            </div>
            <div style={{ marginTop: 20, fontFamily: SE.sans, fontSize: 12, color: SE.fg3, lineHeight: 1.6, maxWidth: 260, margin: '20px auto 0' }}>
              Scout runs daily at 06:00 SGT. BUY signals (≥7.0/10) appear here after each run.
            </div>
          </div>
        ) : (
          signals.map(sig => (
            <ScoutCard key={sig.t || sig.ticker} sig={sig}
              expanded={expanded === (sig.t || sig.ticker)}
              onToggle={() => setExpanded(expanded === (sig.t || sig.ticker) ? null : (sig.t || sig.ticker))}
            />
          ))
        )}
        <div style={{ height: 16 }}/>
      </div>

      <SEBottomNav active="scout" onNavigate={onNavigate}/>
    </SEPhone>
  );
}

function ScoutCard({ sig, expanded, onToggle }) {
  const ticker = sig.t || sig.ticker;
  const score = sig.score || 0;
  const grade = sig.grade || (score >= 8.5 ? 'STRONG BUY' : 'BUY');
  const lens = sig.lens || sig.scout_lens || '';
  const thesis = sig.thesis || sig.majority_thesis || '';
  const scoreColor = score >= 8.5 ? SE.green : score >= 7.5 ? SE.indigo : SE.amber;
  return (
    <div style={{ borderBottom: `1px solid ${SE.b1}` }}>
      <button onClick={onToggle} style={{
        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
        padding: '14px 16px', textAlign: 'left', display: 'block',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 44, height: 36, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: `${scoreColor}14`, border: `1px solid ${scoreColor}44`, borderRadius: 2, flexShrink: 0,
          }}>
            <div style={{ fontFamily: SE.mono, fontSize: 14, fontWeight: 700, color: scoreColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{score.toFixed(1)}</div>
            <div style={{ fontFamily: SE.mono, fontSize: 7, color: scoreColor, letterSpacing: 0.6, marginTop: 1 }}>/10</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <span style={{ fontFamily: SE.mono, fontSize: 14, fontWeight: 700, color: SE.fg0, letterSpacing: 0.6 }}>{ticker}</span>
              <SEPill kind={grade}/>
              {lens && (
                <span style={{
                  fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1, textTransform: 'uppercase',
                  padding: '2px 5px', border: `1px solid ${SE.b2}`, borderRadius: 2,
                }}>{lens}</span>
              )}
            </div>
            <div style={{ fontFamily: SE.sans, fontSize: 11.5, color: SE.fg2, lineHeight: 1.4 }}>{thesis.slice(0, 120)}{thesis.length > 120 ? '…' : ''}</div>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s', flexShrink: 0 }}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke={SE.fg3} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          </svg>
        </div>
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 14px', background: SE.bg1, borderTop: `1px solid ${SE.b1}` }}>
          <div style={{ paddingTop: 10 }}>
            {sig.bull && <DebateRow label="BULL" color={SE.green} text={sig.bull}/>}
            {sig.bear && <DebateRow label="BEAR" color={SE.red} text={sig.bear}/>}
            {sig.verdict && <DebateRow label="VERDICT" color={SE.indigo} text={sig.verdict} bold/>}
            {sig.key_swing_factor && <DebateRow label="SWING" color={SE.amber} text={sig.key_swing_factor}/>}
            {sig.gemma_rationale && <DebateRow label="TRIAGE" color={SE.fg2} text={sig.gemma_rationale}/>}
          </div>
        </div>
      )}
    </div>
  );
}

function DebateRow({ label, color, text, bold }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0' }}>
      <div style={{ flexShrink: 0, width: 56 }}>
        <span style={{
          fontFamily: SE.mono, fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color,
          padding: '2px 5px', border: `1px solid ${color}44`, borderRadius: 2, background: `${color}11`,
        }}>{label}</span>
      </div>
      <div style={{ fontFamily: SE.sans, fontSize: 11.5, color: bold ? SE.fg0 : SE.fg1, lineHeight: 1.5, fontWeight: bold ? 600 : 400, flex: 1 }}>{text}</div>
    </div>
  );
}

// ── SCREEN 4: Position Detail ──────────────────────────────────────────────────

const METRICS_MAP = {
  NVDA: { pe: 48.2, eps: 23.31, tgt: 1280, beta: 1.74 },
  AMZN: { pe: 41.6, eps:  5.74, tgt:  260, beta: 1.18 },
  MSFT: { pe: 36.4, eps: 13.14, tgt:  520, beta: 0.92 },
  GOOGL: { pe: 26.1, eps: 7.61, tgt:  225, beta: 1.04 },
  GOOG: { pe: 25.9, eps: 7.58, tgt:  225, beta: 1.03 },
  META: { pe: 28.8, eps: 24.45, tgt:  760, beta: 1.32 },
  TSLA: { pe: 64.2, eps:  4.38, tgt:  295, beta: 2.04 },
  AMD:  { pe: 42.1, eps:  4.00, tgt:  190, beta: 1.66 },
  PLTR: { pe: 184., eps:  0.26, tgt:   58, beta: 2.21 },
  ASML: { pe: 38.6, eps: 25.44, tgt: 1080, beta: 1.08 },
  TSM:  { pe: 28.1, eps:  7.28, tgt:  230, beta: 1.04 },
  JPM:  { pe: 13.2, eps: 20.11, tgt:  260, beta: 0.96 },
  LLY:  { pe: 42.8, eps: 20.22, tgt:  990, beta: 0.46 },
  XOM:  { pe: 14.1, eps:  9.18, tgt:  120, beta: 0.78 },
  COST: { pe: 54.6, eps: 17.46, tgt:  980, beta: 0.72 },
  GE:   { pe: 32.4, eps:  5.01, tgt:  200, beta: 1.18 },
  UNH:  { pe: 22.1, eps: 26.44, tgt:  590, beta: 0.64 },
};

function SEScreenDetail({ position, onBack, onNavigate }) {
  const pos = position;
  if (!pos) return null;
  const ext = pos.px * (1 + (pos.dPct >= 0 ? 0.0018 : -0.0022));
  const metrics = METRICS_MAP[pos.t] || { pe: 30, eps: 5, tgt: pos.px * 1.1, beta: pos.beta || 1 };
  const relevantNews = M_NEWS_SEED.filter(n => n.ticker === pos.t);
  const relevantFilings = M_SEC_SEED.filter(f => f.ticker === pos.t);
  const displayNews = relevantNews.length > 0 ? relevantNews : M_NEWS_SEED.slice(0, 3).map(n => ({ ...n, ticker: pos.t }));
  const displayFilings = relevantFilings.length > 0 ? relevantFilings : M_SEC_SEED.slice(0, 2).map(f => ({ ...f, ticker: pos.t }));

  const [ddData, setDdData] = useState(null);
  const [ddLoading, setDdLoading] = useState(true);
  useEffect(() => {
    setDdData(null);
    setDdLoading(true);
    fetch(`/api/dd/${pos.t.toLowerCase()}`)
      .then(r => r.ok ? r.json() : null)
      .then(raw => { setDdData(extractDD(raw)); setDdLoading(false); })
      .catch(() => setDdLoading(false));
  }, [pos.t]);

  return (
    <SEPhone>
      {/* Custom header */}
      <div style={{
        padding: '12px 12px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: `1px solid ${SE.b1}`, background: SE.bg0, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SE.fg1,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 2L4 8L10 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: SE.mono, fontSize: 17, fontWeight: 700, color: SE.fg0, letterSpacing: 0.6 }}>{pos.t}</div>
          <div style={{ fontFamily: SE.sans, fontSize: 11, color: SE.fg3, marginTop: 1 }}>{pos.name}</div>
        </div>
        <div style={{
          padding: '4px 8px', border: `1px solid ${SE.b2}`,
          fontFamily: SE.mono, fontSize: 9, color: SE.fg2, letterSpacing: 1.2, fontWeight: 700,
        }}>NASDAQ</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Price block */}
        <div style={{
          padding: '16px 16px 14px',
          background: `linear-gradient(180deg, ${SE.bg1} 0%, ${SE.bg0} 100%)`,
          borderBottom: `1px solid ${SE.b1}`,
        }}>
          <div style={{ fontFamily: SE.mono, fontSize: 30, fontWeight: 700, color: SE.fg0, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3, lineHeight: 1.05 }}>
            ${money(pos.px)}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 5 }}>
            <SENum value={pos.dPct} fmt={v => (v >= 0 ? '+' : '') + pct(Math.abs(v))} size={13} weight={600}/>
            <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 0.6 }}>TODAY</span>
          </div>
          <div style={{ marginTop: 12, height: 80 }}>
            <SEPriceSpark dir={pos.trend} ticker={pos.t}/>
          </div>
          {/* Ext hours */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: SE.bg2, border: `1px solid ${SE.b1}` }}>
            <span style={{ fontFamily: SE.mono, fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: SE.amber, padding: '2px 5px', background: `${SE.amber}1a`, border: `1px solid ${SE.amber}33` }}>EXT</span>
            <span style={{ fontFamily: SE.mono, fontSize: 12, color: SE.fg1, fontVariantNumeric: 'tabular-nums' }}>${money(ext)}</span>
            <SENum value={ext - pos.px} fmt={v => (v >= 0 ? '+$' : '-$') + money(Math.abs(v), 2)} size={11} weight={600} glow={false}/>
            <span style={{ marginLeft: 'auto', fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>AFTER-HRS</span>
          </div>
        </div>

        {/* Your position */}
        <SESectionHeader label="YOUR POSITION"/>
        <div style={{ margin: '0 16px', border: `1px solid ${SE.b1}`, background: SE.bg1 }}>
          {[
            ['SHARES', fmt.shares(pos.sh)],
            ['AVG COST', '$' + money(pos.cost)],
            ['COST BASIS', '$' + money(pos.costBasis, 0)],
            ['MKT VALUE', '$' + money(pos.value, 0), true],
          ].map(([label, val, bold], i, arr) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: i < arr.length - 1 ? `1px solid ${SE.b1}` : 'none',
            }}>
              <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600 }}>{label}</span>
              <span style={{ fontFamily: SE.mono, fontSize: bold ? 14 : 13, color: SE.fg0, fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 600 }}>{val}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
            <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600 }}>UNREALIZED</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <SENum value={pos.value - pos.costBasis} fmt={v => (v >= 0 ? '+$' : '-$') + money(Math.abs(v), 0)} size={13} weight={700}/>
              <SENum value={((pos.px - pos.cost) / pos.cost) * 100} fmt={v => (v >= 0 ? '+' : '') + pct(Math.abs(v))} size={11} weight={600}/>
            </div>
          </div>
        </div>

        {/* Key metrics */}
        <SESectionHeader label="KEY METRICS"/>
        <div style={{ margin: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: SE.b1, border: `1px solid ${SE.b1}` }}>
          {[
            ['P/E', metrics.pe.toFixed(1)],
            ['EPS (TTM)', '$' + metrics.eps.toFixed(2)],
            ['ANALYST TGT', '$' + money(metrics.tgt, 0)],
            ['BETA', metrics.beta.toFixed(2)],
          ].map(([k, v]) => (
            <div key={k} style={{ padding: '10px 12px', background: SE.bg1 }}>
              <div style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600 }}>{k}</div>
              <div style={{ fontFamily: SE.mono, fontSize: 15, color: SE.fg0, fontVariantNumeric: 'tabular-nums', marginTop: 3, fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Sovereign DD */}
        <SESectionHeader label="SOVEREIGN DD"/>
        <div style={{ margin: '0 16px 12px', border: `1px solid ${SE.b1}`, background: SE.bg1 }}>
          {ddLoading ? (
            <div style={{ padding: '14px 16px', fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 1 }}>LOADING…</div>
          ) : !ddData ? (
            <div style={{ padding: '14px 16px', fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 1 }}>NO ANALYSIS AVAILABLE</div>
          ) : (
            <div>
              {/* Score + grade row */}
              <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${SE.b1}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: SE.mono, fontSize: 26, fontWeight: 700, color: SE.fg0, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {ddData.score.toFixed(2)}
                </span>
                <span style={{ fontFamily: SE.mono, fontSize: 11, color: SE.fg3, marginTop: 2 }}>/ 10</span>
                <DDGradeBadge grade={ddData.grade} large={true}/>
                <span style={{ marginLeft: 'auto', fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1 }}>
                  {ddData.confidence}
                </span>
              </div>
              {/* Thesis */}
              {ddData.thesis ? (
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${SE.b1}`, fontFamily: SE.sans, fontSize: 11.5, color: SE.fg1, lineHeight: 1.55 }}>
                  {ddData.thesis}
                </div>
              ) : null}
              {/* Key swing factor */}
              {ddData.swing ? (
                <div style={{ padding: '8px 14px', borderBottom: `1px solid ${SE.b1}`, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: SE.mono, fontSize: 8, fontWeight: 700, letterSpacing: 1, color: SE.amber, flexShrink: 0, marginTop: 1 }}>SWING</span>
                  <span style={{ fontFamily: SE.sans, fontSize: 11, color: SE.fg2, lineHeight: 1.4 }}>{ddData.swing}</span>
                </div>
              ) : null}
              {/* Agent scores */}
              {Object.keys(ddData.agentScores).length > 0 ? (
                <div style={{ padding: '8px 14px' }}>
                  <div style={{ fontFamily: SE.mono, fontSize: 8, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600, marginBottom: 6 }}>AGENT SCORES</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                    {Object.entries(ddData.agentScores).map(([agent, score]) => {
                      const s = +score;
                      const color = s >= 6.5 ? SE.green : s <= 4.5 ? SE.red : SE.fg3;
                      const arrow = s >= 6.5 ? '▲' : s <= 4.5 ? '▼' : '→';
                      return (
                        <div key={agent} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontFamily: SE.mono, fontSize: 8, color: SE.fg3, letterSpacing: 0.5, minWidth: 70 }}>{agent.toUpperCase().slice(0, 10)}</span>
                          <span style={{ fontFamily: SE.mono, fontSize: 10, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{s.toFixed(1)}</span>
                          <span style={{ fontFamily: SE.mono, fontSize: 8, color }}>{arrow}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Recent news */}
        <SESectionHeader label={`RECENT NEWS · ${pos.t}`}/>
        <div style={{ borderTop: `1px solid ${SE.b1}` }}>
          {displayNews.slice(0, 3).map((n, i) => (
            <div key={i} style={{ padding: '10px 16px', borderBottom: `1px solid ${SE.b1}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <SEPill kind={n.sentiment === 'bear' ? 'BEAR' : 'BULL'}/>
                <span style={{ fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>{n.src || n.source}</span>
                <span style={{ marginLeft: 'auto', fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>{n.ago || '—'}</span>
              </div>
              {n.url
                ? <a href={n.url} target="_blank" rel="noreferrer" style={{ fontFamily: SE.sans, fontSize: 12, color: SE.fg1, lineHeight: 1.4, textDecoration: 'none' }}>{n.title || n.headline}</a>
                : <div style={{ fontFamily: SE.sans, fontSize: 12, color: SE.fg1, lineHeight: 1.4 }}>{n.title || n.headline}</div>
              }
            </div>
          ))}
        </div>

        {/* SEC filings */}
        <SESectionHeader label="SEC FILINGS"/>
        <div style={{ borderTop: `1px solid ${SE.b1}` }}>
          {displayFilings.slice(0, 2).map((f, i) => (
            <div key={i} style={{ padding: '10px 16px', borderBottom: `1px solid ${SE.b1}`, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <span style={{ padding: '2px 6px', background: SE.bg3, border: `1px solid ${SE.b2}`, fontFamily: SE.mono, fontSize: 9, fontWeight: 700, color: SE.fg1, letterSpacing: 1, borderRadius: 2, flexShrink: 0, marginTop: 2 }}>{f.form}</span>
              <div style={{ flex: 1 }}>
                {f.url
                  ? <a href={f.url} target="_blank" rel="noreferrer" style={{ fontFamily: SE.sans, fontSize: 11.5, color: SE.fg1, lineHeight: 1.4, textDecoration: 'none' }}>{f.tldr || f.desc}</a>
                  : <div style={{ fontFamily: SE.sans, fontSize: 11.5, color: SE.fg1, lineHeight: 1.4 }}>{f.tldr || f.desc}</div>
                }
                <div style={{ marginTop: 4, fontFamily: SE.mono, fontSize: 9, color: SE.fg3 }}>{f.date || f.ago}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ height: 16 }}/>
      </div>

      <SEBottomNav active="portfolio" onNavigate={onNavigate}/>
    </SEPhone>
  );
}

// ── SCREEN 5: Settings ─────────────────────────────────────────────────────────

function SEScreenSettings({ data, onNavigate, positions, onSavePositions }) {
  const { meta } = data;
  const [showKey, setShowKey] = useState({});
  const [schedule, setSchedule] = useState('daily');
  const [syncStatus, setSyncStatus] = useState('');

  const tickers = positions.map(p => p.ticker).join(', ');
  const apiKey = M_CONFIG.FINNHUB_API_KEY || '';
  const maskedKey = apiKey ? apiKey.slice(0, 4) + '••••••••' + apiKey.slice(-4) : '(not configured)';

  const handleSync = async () => {
    setSyncStatus('syncing');
    try {
      await kvSave(positions);
      setSyncStatus('synced');
      setTimeout(() => setSyncStatus(''), 2500);
    } catch (e) {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus(''), 2000);
    }
  };

  return (
    <SEPhone>
      <SEAppHeader session={meta.session} sgt={meta.sgt} sub={meta.date}/>
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* API Keys */}
        <SESectionHeader label="API KEYS"/>
        <div style={{ borderTop: `1px solid ${SE.b1}` }}>
          {[
            { k: 'finnhub', label: 'FINNHUB', val: maskedKey, real: apiKey },
            { k: 'gemini', label: 'GEMINI AI', val: '(server-side)', real: '' },
            { k: 'fred', label: 'FRED', val: '(server-side)', real: '' },
          ].map(api => (
            <div key={api.k} style={{ padding: '12px 16px', borderBottom: `1px solid ${SE.b1}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 1.4, fontWeight: 700 }}>{api.label}</span>
                <span style={{ fontFamily: SE.mono, fontSize: 9, color: api.real ? SE.green : SE.fg3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {api.real && <span style={{ width: 4, height: 4, borderRadius: '50%', background: SE.green, boxShadow: `0 0 4px ${SE.green}` }}/>}
                  {api.real ? 'CONFIGURED' : 'SERVER-SIDE'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: SE.bg2, border: `1px solid ${SE.b1}` }}>
                <span style={{ fontFamily: SE.mono, fontSize: 11, color: SE.fg1, flex: 1 }}>
                  {api.real && showKey[api.k] ? api.real : api.val}
                </span>
                {api.real && (
                  <button onClick={() => setShowKey(s => ({ ...s, [api.k]: !s[api.k] }))} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: SE.mono, fontSize: 9, color: SE.indigo, letterSpacing: 1, fontWeight: 700,
                  }}>{showKey[api.k] ? 'HIDE' : 'SHOW'}</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Portfolio tickers */}
        <SESectionHeader label="PORTFOLIO TICKERS"/>
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ padding: '10px 12px', background: SE.bg2, border: `1px solid ${SE.b1}`, fontFamily: SE.mono, fontSize: 11, color: SE.fg1, lineHeight: 1.6, wordSpacing: 2 }}>
            {tickers || '(no positions)'}
          </div>
          <div style={{ marginTop: 6, fontFamily: SE.mono, fontSize: 9.5, color: SE.fg3 }}>
            {positions.length} SYMBOLS · EDIT POSITIONS ON DESKTOP TO MODIFY
          </div>
        </div>

        {/* Scout schedule */}
        <SESectionHeader label="SCOUT SCHEDULE"/>
        <div style={{ display: 'flex', padding: '0 16px' }}>
          {[
            { k: 'daily', label: 'DAILY' },
            { k: 'weekly', label: 'WEEKLY' },
            { k: 'manual', label: 'MANUAL' },
          ].map((opt, i) => (
            <button key={opt.k} onClick={() => setSchedule(opt.k)} style={{
              flex: 1, padding: '9px 0', cursor: 'pointer',
              background: schedule === opt.k ? `${SE.indigo}1a` : SE.bg1,
              border: `1px solid ${schedule === opt.k ? SE.indigo : SE.b1}`,
              borderLeftWidth: i === 0 ? 1 : 0,
              color: schedule === opt.k ? SE.indigo : SE.fg2,
              fontFamily: SE.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
            }}>{opt.label}</button>
          ))}
        </div>
        <div style={{ padding: '7px 16px 0', fontFamily: SE.mono, fontSize: 9.5, color: SE.fg3 }}>
          {schedule === 'daily' ? '↳ runs 06:00 SGT each weekday' :
           schedule === 'weekly' ? '↳ runs 06:00 SGT every Monday' :
           '↳ runs only when manually triggered'}
        </div>

        {/* Theme */}
        <SESectionHeader label="DISPLAY"/>
        <div style={{ margin: '0 16px', padding: '12px 14px', background: SE.bg1, border: `1px solid ${SE.b1}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: SE.mono, fontSize: 11, color: SE.fg1, fontWeight: 600, letterSpacing: 0.5 }}>THEME</div>
            <div style={{ fontFamily: SE.sans, fontSize: 10.5, color: SE.fg3, marginTop: 3 }}>Dark only. Always.</div>
          </div>
          <span style={{ padding: '4px 8px', border: `1px solid ${SE.b2}`, fontFamily: SE.mono, fontSize: 9, color: SE.fg2, letterSpacing: 1.2, fontWeight: 700 }}>LOCKED</span>
        </div>

        {/* Sync */}
        <SESectionHeader label="SYNC"/>
        <div style={{ margin: '0 16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: SE.bg1, border: `1px solid ${SE.b1}` }}>
            <div>
              <div style={{ fontFamily: SE.mono, fontSize: 9.5, color: SE.fg3, letterSpacing: 1.2, fontWeight: 600 }}>LAST SYNC</div>
              <div style={{ fontFamily: SE.mono, fontSize: 12, color: SE.fg1, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{meta.lastSync}</div>
            </div>
            <button onClick={handleSync} style={{
              padding: '8px 14px', background: syncStatus === 'synced' ? SE.green : syncStatus === 'error' ? SE.red : SE.indigo,
              border: 'none', cursor: 'pointer', color: SE.bg0,
              fontFamily: SE.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, borderRadius: 2,
              transition: 'background 0.2s',
            }}>
              {syncStatus === 'syncing' ? '…SYNCING' : syncStatus === 'synced' ? '✓ SYNCED' : syncStatus === 'error' ? 'ERROR' : 'SYNC NOW'}
            </button>
          </div>
        </div>

        <div style={{ padding: '8px 16px 20px', fontFamily: SE.mono, fontSize: 9, color: SE.fg3, letterSpacing: 1, textAlign: 'center' }}>
          SOVEREIGN EYE · v2.0 · BUILD 2026.05.14
        </div>
      </div>
      <SEBottomNav active="settings" onNavigate={onNavigate}/>
    </SEPhone>
  );
}

// ── Root App ───────────────────────────────────────────────────────────────────

function MobileApp() {
  const [positions, setPositions] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [sgdRate, setSgdRate] = useState(1.35);
  const [liveNews, setLiveNews] = useState([]);
  const [synthesis, setSynthesis] = useState(null);
  const [scout, setScout] = useState(null);
  const [ddIndex, setDdIndex] = useState({});
  const [screen, setScreen] = useState('portfolio');
  const [detailPos, setDetailPos] = useState(null);
  const [tick, setTick] = useState(0);

  // Load positions on mount
  useEffect(() => {
    loadPositions().then(p => setPositions(p));
    fetchSGD().then(r => setSgdRate(r));
    fetchScoutResults().then(r => { if (r) setScout(r); });
    fetch('/api/dd/').then(r => r.ok ? r.json() : {}).then(idx => { if (idx) setDdIndex(idx); }).catch(() => {});
  }, []);

  // Save to localStorage + KV when positions change
  useEffect(() => {
    if (!positions) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); } catch (e) {}
    kvSave(positions);
  }, [positions]);

  // Clock tick (every 30s)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Fetch live data periodically
  const tickers = useMemo(() => positions?.map(p => p.ticker).filter(t => t !== 'USD') || [], [positions]);

  const fetchLive = useCallback(async () => {
    if (!tickers.length) return;
    const q = await fetchQuotes(tickers, M_CONFIG.FINNHUB_API_KEY);
    if (Object.keys(q).length) setQuotes(q);
    const n = await fetchFinnhubNews(tickers, M_CONFIG.FINNHUB_API_KEY);
    if (n.length) setLiveNews(n);
    const s = await fetchSynthesis(tickers);
    if (s) setSynthesis(s);
  }, [tickers]);

  useEffect(() => {
    if (!tickers.length) return;
    fetchLive();
    const ms = M_CONFIG.REFRESH_INTERVAL_MS || 30000;
    const t = setInterval(fetchLive, ms);
    return () => clearInterval(t);
  }, [fetchLive]);

  // Enrich positions for display
  const enriched = useMemo(() => positions ? enrichPositions(positions, quotes, sgdRate) : [], [positions, quotes, sgdRate]);
  const portfolio = useMemo(() => buildPortfolioSummary(enriched, sgdRate), [enriched, sgdRate]);

  // Build live meta
  const { time: sgt, date } = sgtNow();
  const meta = useMemo(() => ({
    session: getSession(),
    sgt, date,
    fxUsdSgd: sgdRate,
    lastSync: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' SGT',
  }), [tick, sgdRate]);

  // Build news for Intel screen
  const intelNews = useMemo(() => {
    if (liveNews.length) {
      return liveNews.map(n => ({
        ticker: n.sym || n.related || '—',
        src: n.source || '—',
        datetime: n.datetime,
        headline: n.headline || n.title,
        url: n.url,
        sent: 'BULL', // Finnhub doesn't provide sentiment — defaulting
      }));
    }
    return M_NEWS_SEED.map(n => ({ ticker: n.ticker, src: n.src, ago: n.ago, headline: n.title, sent: 'BULL' }));
  }, [liveNews]);

  const data = { portfolio, positions: enriched, meta, synthesis, news: intelNews, filings: null, scout, ddIndex };

  const navigate = (s) => { setScreen(s); setDetailPos(null); };
  const tapPosition = (pos) => { setDetailPos(pos); setScreen('detail'); };
  const goBack = () => { setScreen('portfolio'); setDetailPos(null); };

  if (!positions) {
    return (
      <div style={{
        width: '100%', height: '100%', maxWidth: 430, margin: '0 auto',
        background: SE.bg0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
      }}>
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ animation: 'seSpin 1.2s linear infinite' }}>
          <path d="M0.8 8 C 3 3.2, 13 3.2, 15.2 8 C 13 12.8, 3 12.8, 0.8 8 Z" stroke={SE.indigo} strokeWidth="1.2"/>
          <circle cx="8" cy="8" r="2.1" fill={SE.indigo}/>
        </svg>
        <div style={{ fontFamily: SE.mono, fontSize: 10, color: SE.fg3, letterSpacing: 1.8 }}>SOVEREIGN EYE · LOADING</div>
      </div>
    );
  }

  switch (screen) {
    case 'portfolio': return <SEScreenHome data={data} onNavigate={navigate} onTapPosition={tapPosition}/>;
    case 'intel':     return <SEScreenIntel data={data} onNavigate={navigate}/>;
    case 'scout':     return <SEScreenScout data={data} onNavigate={navigate}/>;
    case 'detail':    return <SEScreenDetail position={detailPos} onBack={goBack} onNavigate={navigate}/>;
    case 'settings':  return <SEScreenSettings data={data} onNavigate={navigate} positions={positions} onSavePositions={setPositions}/>;
    default:          return <SEScreenHome data={data} onNavigate={navigate} onTapPosition={tapPosition}/>;
  }
}

window.MobileApp = MobileApp;

ReactDOM.createRoot(document.getElementById('root')).render(<MobileApp/>);
