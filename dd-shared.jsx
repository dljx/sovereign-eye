/* global React, window */
// Shared DD helpers used by BOTH desktop-panels.jsx and mobile.jsx. Loaded as a
// <script type="text/babel"> before them; exposes globals via window (same pattern
// as components.jsx) so the two platforms can't drift apart.
(function () {
const { useState } = React;

function _fmtElapsed(s) {
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

// Real agent labels/ids → design agent kind (for AgentPixel).
const _AGENT_KINDS = {
  Valuation: 'valuation', Macro: 'macro', TechAnalysis: 'techanalysis',
  FundForensics: 'fundforensics', MarketStructure: 'marketstructure',
};
const _DESIGN_AGENTS = [
  { name: 'Valuation', k: 'valuation' },
  { name: 'Macro', k: 'macro' },
  { name: 'TechAnalysis', k: 'techanalysis' },
  { name: 'FundForensics', k: 'fundforensics' },
  { name: 'MarketStructure', k: 'marketstructure' },
];
// Real sovereign-dd agent names → design agent names.
const _AGENT_NAME_MAP = {
  StructuralEdge: 'Valuation', FundamentalForensics: 'FundForensics',
  ValuationEngine: 'Macro', CatalystHunter: 'TechAnalysis',
  MarketStructure: 'MarketStructure',
  MOAT: 'Valuation', FUND: 'FundForensics', VAL: 'Macro',
  CATL: 'TechAnalysis', MKT: 'MarketStructure',
};

function DDTranscriptEntry({ t }) {
  const r = String(t.round);
  const roundLabel = t.round === 1 ? 'R1 · Initial'
    : r.startsWith('2') ? 'R2 · Challenge'
    : r.startsWith('3') ? 'R3 · Rebuttal'
    : t.round === 'synthesis' ? 'Synthesis'
    : `R${t.round}`;
  const score = t.revised_score != null ? t.revised_score : t.score;
  return (
    <div className="dd-turn">
      <div className="dd-turn-head">
        <span className="dd-turn-agent">{t.agent}</span>
        <span className="dd-turn-round">{roundLabel}</span>
        {t.target_agent && <span className="dd-turn-target">→ {t.target_agent}</span>}
        {score != null && (
          <span className="dd-turn-score">
            {(+score).toFixed(1)}{t.score_delta != null ? ` (${t.score_delta > 0 ? '+' : ''}${t.score_delta})` : ''}
          </span>
        )}
      </div>
      {t.thesis && <div className="dd-turn-body">{t.thesis}</div>}
      {t.challenge && <div className="dd-turn-body">{t.challenge}</div>}
      {t.rebuttal && <div className="dd-turn-body">{t.rebuttal}</div>}
      {t.concessions && <div className="dd-turn-body dd-turn-concede"><b>Concedes:</b> {t.concessions}</div>}
      {t.final_thesis && <div className="dd-turn-body"><b>Final:</b> {t.final_thesis}</div>}
      {t.direct_question && <div className="dd-turn-q">Q: {t.direct_question}</div>}
      {t.key_risk && <div className="dd-turn-risk">Risk: {t.key_risk}</div>}
    </div>
  );
}

// Quantified risk/reward chip (results may predate the rr layer → render nothing).
function RRChip({ rr }) {
  if (!rr || !rr.applied || rr.rr_ratio == null) return null;
  const cls = rr.quadrant === 'LOW_RISK_HIGH_REWARD' ? 'rr-good'
    : rr.quadrant === 'HIGH_RISK_LOW_REWARD' ? 'rr-bad'
    : 'rr-mixed';
  return (
    <span className={`dd-chip ${cls}`}>
      R/R {(+rr.rr_ratio).toFixed(1)}:1 · {rr.risk_tier || '?'} RISK
    </span>
  );
}

// Hold-mode label translation. Portfolio-screen results arrive with
// mode === 'hold' and use the ADD/HOLD/TRIM/EXIT ladder instead of BUY/SELL;
// re-derived from the score so older payloads stay correct.
function holdLabel(score) {
  const s = Number(score);
  if (!isFinite(s)) return 'HOLD';
  if (s >= 7.0) return 'ADD';
  if (s >= 5.5) return 'HOLD';
  if (s >= 3.5) return 'TRIM';
  return 'EXIT';
}
function gradeForResult(d) {
  if (d && d.mode === 'hold') return holdLabel(d.consensus_score ?? d.score);
  return (d?.consensus_grade ?? d?.grade ?? 'HOLD').toString().trim();
}

// News time/decay/filter helpers — one implementation for both news panels.
const NEWS_PERIOD_SECS = { '1D': 86400, '1W': 604800, '1M': 2592000 };
function parseAgoMs(t) {
  const m = (t || '').match(/^(\d+)(m|h|d)$/);
  if (!m) return 0;
  return +m[1] * (m[2] === 'm' ? 60000 : m[2] === 'h' ? 3600000 : 86400000);
}
function _agoToSec(t) {
  const m = (t || '').match(/(\d+)\s*(m|h|d)/);
  if (!m) return 0;
  return +m[1] * (m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 86400);
}
function newsEffectiveTs(n) {
  // Valid Unix epoch in seconds: between 2001-09-09 and 2033-05-18
  if (n.datetime >= 1000000000 && n.datetime <= 2000000000) return n.datetime;
  const age = _agoToSec(n.t || n.ago);
  if (age > 0) return Math.floor(Date.now() / 1000) - age;
  return Math.floor(Date.now() / 1000); // unknown → treat as now
}
function decayImp(importance, ts) {
  const ageDays = (Date.now() / 1000 - (ts || 0)) / 86400;
  return Math.round((importance || 0) * Math.max(0.4, 1 - ageDays / 20));
}
function applyNewsFilters(items, period, sortMode) {
  const cutoff = NEWS_PERIOD_SECS[period] || NEWS_PERIOD_SECS['1W'];
  const nowSec = Date.now() / 1000;
  const withTs = items.map(n => ({ ...n, _ts: newsEffectiveTs(n) }));
  const filtered = withTs.filter(n => (nowSec - n._ts) < cutoff);
  return sortMode === 'rank'
    ? [...filtered].sort((a, b) => decayImp(b.importance, b._ts) - decayImp(a.importance, a._ts))
    : [...filtered].sort((a, b) => b._ts - a._ts);
}

// Normalize a sovereign-dd scout/gems/watchlist card → the shape both scout
// panels render. Was duplicated per platform and had already drifted.
function normalizeScoutCard(s) {
  const ver = s.verification || {};
  const dated = s.analyzed_at || ver.checked_at || '';
  const ts = Date.parse(dated);
  return {
    tk: s.ticker || s.tk || '—',
    score: s.score ?? 0,
    grade: (s.grade ?? s.consensus_grade ?? 'HOLD').replace(/ /g, '-').toUpperCase(),
    sector: s.sector || '—',
    valPath: s.path || s.valPath || '—',
    rationale: s.gemma_rationale || s.rationale || s.thesis || '—',
    filters: s.matched_filters || s.filters || [],
    conf: s.conf || s.confidence || '',
    thesis: s.thesis || s.majority_thesis || '',
    keySwing: s.key_swing || s.key_swing_factor || '',
    catalyst: s.catalyst || '',
    asymmetry: s.asymmetry_ratio || '',
    position: s.position_guidance || null,
    banger: s.banger || null,
    cycle: s.cycle_position || null,
    rr: s.rr ?? null,
    risk: s.risk || null,
    analyzedAt: dated,
    // Days since the debate ran (null when the card predates date stamping).
    // A verdict is priced on run-date data — the age is part of the signal.
    ageDays: Number.isFinite(ts) ? Math.max(0, Math.floor((Date.now() - ts) / 86400000)) : null,
    // Confirmation-gate fields (Under Review tab + v3 flagged DOWNGRADEs)
    verdict: ver.verdict || null,
    reviewReason: ver.strongest_bear_point || (ver.reasons || [])[0] || '',
    vscore: ver.verification_score ?? null,
  };
}

// Rich dossier body — one renderer for the mobile DD screen/popup AND the
// desktop DD panel (which previously hand-rolled a reduced version missing
// fair value, moat, banger, cycle, and the transcript).
function DDResultFull({ data }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const gradeClass = g => (g || '').toLowerCase().replace(/[\s_-]+/g, '-');
  const scoreColor = s => s >= 7 ? 'bull' : s <= 5 ? 'bear' : 'neutral';
  const pos = data.position_guidance || null;
  return (
    <>
      <div className="dd-result-header">
        <div>
          <div className="dd-ticker">{data.ticker}</div>
          <div className="dd-conf">CONF: {data.confidence || '—'}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div className="dd-score">{Number(data.consensus_score ?? data.score ?? 0).toFixed(1)}<span className="denom"> / 10</span></div>
          {(() => { const lbl = gradeForResult(data); return <div className={`dd-grade ${gradeClass(lbl)}`}>{lbl}</div>; })()}
        </div>
      </div>
      <div className="dd-chips">
        {data.entry_assessment && <span className="dd-chip">Entry: {String(data.entry_assessment).replace(/_/g, ' ')}</span>}
        {data.fair_value_composite != null && <span className="dd-chip">Fair value: ${data.fair_value_composite}</span>}
        <RRChip rr={data.risk_reward} />
        {data.asymmetry_ratio && <span className="dd-chip">Asymmetry: {data.asymmetry_ratio}</span>}
        {data.moat_composite != null && <span className="dd-chip">Moat: {data.moat_composite}/10</span>}
        {pos?.range && <span className="dd-chip">Size: {pos.range}</span>}
        {data.cycle_position?.regime && <span className="dd-chip">{data.cycle_position.regime} · {data.cycle_position.phase}</span>}
        {data.banger?.is_banger && <span className="dd-chip dd-chip-hot">BANGER</span>}
      </div>
      <div className="dd-section">
        <div className="dd-section-label">Majority Thesis</div>
        <div className="dd-thesis">{data.majority_thesis ?? data.thesis}</div>
      </div>
      {data.catalyst && (
        <div className="dd-section">
          <div className="dd-section-label">Catalyst</div>
          <div className="dd-thesis">{data.catalyst}</div>
        </div>
      )}
      {(data.key_swing_factor ?? data.swing) && (
        <div className="dd-section">
          <div className="dd-section-label">Key Swing Factor</div>
          <div className="dd-swing">{data.key_swing_factor ?? data.swing}</div>
        </div>
      )}
      {data.dissent && (
        <div className="dd-section">
          <div className="dd-section-label">Dissent</div>
          <div className="dd-dissent">{data.dissent}</div>
        </div>
      )}
      {data.agent_final_scores && (
        <div className="dd-section">
          <div className="dd-section-label">Agent Scores (R1 → final)</div>
          <div className="dd-agents">
            {Object.entries(data.agent_final_scores).map(([name, fin]) => {
              const r1 = data.agent_r1_scores?.[name];
              return (
                <div key={name} className="dd-agent">
                  <div className="ag-name">{name}</div>
                  <div className={`ag-vote ${scoreColor(fin)}`}>{Number(fin).toFixed(1)}</div>
                  <div className="ag-rationale">{r1 != null ? `R1 ${Number(r1).toFixed(1)} → ${Number(fin).toFixed(1)}` : `Final ${Number(fin).toFixed(1)}`}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {Array.isArray(data.transcript) && data.transcript.length > 0 && (
        <div className="dd-section">
          <div className="dd-section-label dd-transcript-toggle" onClick={() => setShowTranscript(v => !v)}>
            {showTranscript ? '▼' : '▶'} Full Debate Transcript ({data.transcript.length} turns)
          </div>
          {showTranscript && (
            <div className="dd-transcript">
              {data.transcript.filter(t => t.round !== 'synthesis').map((t, i) => <DDTranscriptEntry key={i} t={t} />)}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Compact SGD label for chart axes/heroes: S$1.2M / S$850k / S$900.
function fmtSgdCompact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `S$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `S$${Math.round(v / 1e3)}k`;
  return `S$${Math.round(v)}`;
}

// FIRE progress chart: solid NAV history (SGD), dashed central projection with
// a ∓2pp return band, the (age-65-stepped) FIRE-number line, and a crossover
// marker. Pure render — all math comes from window.FireMath.
// props: { history: [{date:'YYYY-MM-DD', value}], settings, liquidNow, w, h }
function FireChart({ history = [], settings: s, liquidNow, w = 680, h = 240 }) {
  const FM = window.FireMath;
  const now = new Date();
  const baseYear = now.getFullYear();

  // CPF in the plan: withdrawable OA joins the asset line, CPF Life offsets
  // the FIRE line from 65 — same series crossover() uses internally.
  const inPlan = !!(s.cpf && s.cpf.includeInPlan);
  const sim = inPlan || Number(s.cpfLifeMonthly) > 0 ? FM.cpfSimulate(s, FM.MONTHS_HORIZON, now) : null;
  const life = FM.cpfLifeOffset(s, sim);
  const wd = inPlan && sim ? sim.withdrawable : null;

  // Horizon: crossover + 3y when reachable, else 15y.
  const xo = FM.crossover(s, liquidNow, now);
  const horizonMonths = Math.min(FM.MONTHS_HORIZON, (xo ? xo.months + 36 : 180));

  const central = FM.project(s, liquidNow, horizonMonths, 0, wd);
  const low     = FM.project(s, liquidNow, horizonMonths, -2, wd);
  const high    = FM.project(s, liquidNow, horizonMonths, +2, wd);

  const t0 = history.length ? new Date(history[0].date) : now;
  const tEnd = new Date(now.getFullYear(), now.getMonth() + horizonMonths + 1, 1);
  const span = tEnd - t0 || 1;

  const fireAt = (d) => FM.fireNumberAt(d.getFullYear(), s, baseYear, life);
  const fireEnd = fireAt(tEnd);
  const maxV = Math.max(fireEnd, fireAt(now), high[high.length - 1] || 0,
                        liquidNow, ...history.map(p => p.value)) * 1.06;
  const minV = 0;

  const X = (d) => 40 + ((d - t0) / span) * (w - 52);
  const Y = (v) => 6 + (1 - (v - minV) / (maxV - minV || 1)) * (h - 34);
  const monthDate = (m) => new Date(now.getFullYear(), now.getMonth() + m + 1, 1);

  const histPts = history.map(p => `${X(new Date(p.date)).toFixed(1)},${Y(p.value).toFixed(1)}`);
  if (liquidNow != null) histPts.push(`${X(now).toFixed(1)},${Y(liquidNow).toFixed(1)}`);

  const projPath = (arr) => [`${X(now).toFixed(1)},${Y(liquidNow).toFixed(1)}`,
    ...arr.map((v, m) => `${X(monthDate(m)).toFixed(1)},${Y(v).toFixed(1)}`)].join(' ');
  const bandPath = `M ${projPath(high).replace(/ /g, ' L ')} L ${
    [...low].reverse().map((v, i) => `${X(monthDate(low.length - 1 - i)).toFixed(1)},${Y(v).toFixed(1)}`).join(' L ')} Z`;

  // FIRE line: yearly points; the age-65 CPF-Life step lands naturally.
  const firePts = [];
  for (let yr = t0.getFullYear(); yr <= tEnd.getFullYear(); yr++) {
    const dJan = new Date(Math.max(t0, new Date(yr, 0, 1)));
    firePts.push(`${X(dJan).toFixed(1)},${Y(fireAt(dJan)).toFixed(1)}`);
    const step65 = (Number(s.birthYear) || 0) + 65 === yr + 1;
    if (step65) firePts.push(`${X(new Date(yr, 11, 31)).toFixed(1)},${Y(fireAt(new Date(yr, 0, 1))).toFixed(1)}`);
  }
  firePts.push(`${X(tEnd).toFixed(1)},${Y(fireEnd).toFixed(1)}`);

  const yTicks = [0.25, 0.5, 0.75, 1].map(f => minV + (maxV - minV) * f);
  const xYears = [];
  for (let yr = t0.getFullYear() + 1; yr <= tEnd.getFullYear(); yr += Math.max(1, Math.round((tEnd.getFullYear() - t0.getFullYear()) / 6))) {
    xYears.push(yr);
  }

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {yTicks.map(v => (
        <g key={v}>
          <line x1="40" x2={w - 12} y1={Y(v)} y2={Y(v)} stroke="var(--border-1)" strokeDasharray="2,4" />
          <text x="36" y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--mono)">{fmtSgdCompact(v)}</text>
        </g>
      ))}
      {xYears.map(yr => (
        <text key={yr} x={X(new Date(yr, 0, 1))} y={h - 6} textAnchor="middle" fontSize="9" fill="var(--fg-3)" fontFamily="var(--mono)">{yr}</text>
      ))}

      <path d={bandPath} fill="var(--acc)" opacity="0.08" />
      {histPts.length > 1 && <polyline points={histPts.join(' ')} fill="none" stroke="var(--acc)" strokeWidth="1.8" />}
      <polyline points={projPath(central)} fill="none" stroke="var(--acc)" strokeWidth="1.2" strokeDasharray="4,4" opacity="0.85" />
      <polyline points={firePts.join(' ')} fill="none" stroke="var(--warn, #f59e0b)" strokeWidth="1.4" />

      {liquidNow != null && <circle cx={X(now)} cy={Y(liquidNow)} r="3" fill="var(--acc)" />}
      {xo && (
        <g>
          <circle cx={X(xo.date)} cy={Y(fireAt(xo.date))} r="4" fill="none" stroke="var(--pos, #34d399)" strokeWidth="1.6" />
          <text x={Math.min(X(xo.date), w - 90)} y={Math.max(14, Y(fireAt(xo.date)) - 10)} fontSize="10" fill="var(--pos, #34d399)" fontFamily="var(--mono)">
            FIRE ≈ {xo.date.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })}
          </text>
        </g>
      )}
    </svg>
  );
}

// Full FIRE tab body — data fetching, hero numbers, chart, settings form —
// shared verbatim by desktop (FirePanel) and mobile (MobileFire) so the two
// can never drift. `compact` stacks the layout for phone widths.
const FIRE_DEFAULTS = {
  monthlyExpenses: 4000, swr: 3.5, inflation: 2.5, expectedReturn: 6.0,
  monthlyContribution: 0, otherAssetsSGD: 0, birthYear: 1997,
  // CPF modeled from official rules (see FireMath.CPF): balances today +
  // total monthly inflow (employee + employer). includeInPlan turns on the
  // full simulation — OA unlocks into the asset line at 55, RA becomes the
  // CPF Life offset at 65. cpfLifeMonthly > 0 overrides the auto-estimate.
  cpf: { oa: 0, sa: 0, ma: 0, monthlyContribution: 0, includeInPlan: false },
  cpfLifeMonthly: 0,
};

// Settings saved before the CPF engine (2026-07-09) had {balance, growthRate,
// includeAsAsset} — map them onto the new shape instead of dropping them.
function migrateFireSettings(d) {
  if (!d || !d.cpf) return d;
  const c = d.cpf;
  if (c.oa == null && c.balance != null) {
    d = { ...d, cpf: { oa: c.balance, sa: 0, ma: 0, monthlyContribution: 0, includeInPlan: !!c.includeAsAsset } };
  }
  return d;
}

// Device-side mirror of the FIRE settings. Every save writes here FIRST, so a
// failed/unreachable server can cost at most one round of typing — the form
// hydrates from this copy whenever the server has nothing. (Learned the hard
// way: the KV copy was lost once and the silent fall-back-to-defaults made it
// look like saving never worked.)
const FIRE_LS_KEY = 'fire:settings';
function readLocalFire() {
  try { return JSON.parse(localStorage.getItem(FIRE_LS_KEY) || 'null'); } catch { return null; }
}

function FireBody({ compact = false, onRate }) {
  const { useEffect } = React;
  const [s, setS] = useState(null);            // null = loading
  const [rawHist, setRawHist] = useState([]);  // [{date, navUsd}]
  const [sgdRate, setSgdRate] = useState(window.CCY_RATES?.SGD || 1.35);
  const [saveState, setSaveState] = useState('idle'); // idle | busy | saved | err
  const [saveErr, setSaveErr] = useState('');
  // Where the numbers on screen came from: server | local | defaults | local-offline
  const [source, setSource] = useState('server');

  useEffect(() => {
    const merged = (raw) => {
      const d = migrateFireSettings(raw);
      return { ...FIRE_DEFAULTS, ...(d || {}), cpf: { ...FIRE_DEFAULTS.cpf, ...((d || {}).cpf || {}) } };
    };
    fetch('/api/fire')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        const hasServer = d && Object.keys(d).some(k => k !== 'updatedAt');
        if (hasServer) { setS(merged(d)); setSource('server'); return; }
        const local = readLocalFire();
        setS(merged(local));
        setSource(local ? 'local' : 'defaults');
      })
      .catch(() => {
        const local = readLocalFire();
        setS(merged(local));
        setSource(local ? 'local-offline' : 'defaults');
      });
    fetch('/api/nav-history').then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.raw?.dates) setRawHist(d.raw.dates.map((date, i) => ({ date, navUsd: d.raw.nav[i] })));
      }).catch(() => {});
    fetch('/api/sgd-rate').then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.rate) { setSgdRate(d.rate); onRate && onRate(d.rate); } }).catch(() => {});
  }, []);

  if (!s) return <div className="news-loading"><div className="news-spinner" /><span>Loading FIRE settings…</span></div>;

  const FM = window.FireMath;
  const liquidNow = FM.liquidAssetsSGD(window.__NLV || 0, sgdRate, s);
  // Historical points get today's extras added (their own history isn't
  // tracked) — the line is "your assets as composed today, priced then".
  const extras = liquidNow - (window.__NLV || 0) * sgdRate;
  const history = rawHist.map(p => ({ date: p.date, value: p.navUsd * sgdRate + extras }));
  const yearNow = new Date().getFullYear();
  const age = s.birthYear > 1900 ? yearNow - s.birthYear : null;
  const cpfSim = s.cpf.includeInPlan ? FM.cpfSimulate(s, FM.MONTHS_HORIZON) : null;
  const cpfLife = FM.cpfLifeOffset(s, cpfSim);
  const cpfBand = age != null ? FM.cpfAlloc(age) : null;
  const fireNow = FM.fireNumberAt(yearNow, s, yearNow, cpfLife);
  const pct = fireNow > 0 && isFinite(fireNow) ? (liquidNow / fireNow) * 100 : 0;
  const xo = FM.crossover(s, liquidNow);

  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  const setCpf = (k, v) => setS(prev => ({ ...prev, cpf: { ...prev.cpf, [k]: v } }));
  const save = async () => {
    setSaveState('busy');
    setSaveErr('');
    // Device copy first — unconditionally. The server write can fail; this can't.
    try { localStorage.setItem(FIRE_LS_KEY, JSON.stringify(s)); } catch {}
    try {
      const r = await fetch('/api/fire', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
      });
      if (r.ok) {
        setSaveState('saved');
        setSource('server');
        setTimeout(() => setSaveState('idle'), 2000);
      } else {
        setSaveState('err');
        setSaveErr(`server rejected the save (HTTP ${r.status}) — kept on this device only`);
      }
    } catch {
      setSaveState('err');
      setSaveErr('network error — kept on this device only');
    }
  };

  const num = (k, label, step = 'any', nested = false) => (
    <label key={(nested ? 'cpf.' : '') + k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>{label}</span>
      <input type="number" step={step}
        value={(nested ? s.cpf[k] : s[k]) ?? ''}
        onChange={e => {
          const v = e.target.value === '' ? 0 : +e.target.value;
          nested ? setCpf(k, v) : set(k, v);
        }}
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-1)', color: 'var(--fg-0)', font: 'inherit', padding: '5px 8px' }} />
    </label>
  );

  return (
    <>
      <div className="sb-hero" style={compact ? { flexWrap: 'wrap', gap: 12 } : null}>
        <div>
          <div className="sb-big">{fmtSgdCompact(liquidNow)}</div>
          <div className="sb-big-label">Liquid assets now</div>
        </div>
        <div>
          <div className="sb-big" style={{ color: 'var(--warn)' }}>{isFinite(fireNow) ? fmtSgdCompact(fireNow) : '—'}</div>
          <div className="sb-big-label">FIRE number today</div>
        </div>
        <div>
          <div className={`sb-big ${pct >= 100 ? 'pos' : ''}`}>{pct.toFixed(0)}%</div>
          <div className="sb-big-label">of the way there</div>
        </div>
        <div>
          <div className="sb-big pos">{xo ? xo.date.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }) : '> 40y'}</div>
          <div className="sb-big-label">Projected crossover</div>
        </div>
      </div>

      <div style={compact
        ? { display: 'flex', flexDirection: 'column', gap: 16 }
        : { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18, alignItems: 'start' }}>
        <div>
          {history.length < 2 && (
            <div className="mono dim" style={{ fontSize: 10, marginBottom: 6 }}>
              NAV history accumulates one snapshot per day from now on ({history.length} so far) — the solid line fills in as data builds; everything right of the dot is projection.
            </div>
          )}
          <FireChart history={history} settings={s} liquidNow={liquidNow}
            w={compact ? 360 : 680} h={compact ? 200 : 240} />
          <div className="mono dim" style={{ fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>
            <b>How this is computed</b> — FIRE number = annual expenses (inflated {s.inflation}%/yr) ÷ SWR {s.swr}%;
            from age 65 CPF Life ({cpfLife > 0 ? `S$${Math.round(cpfLife)}/mo, ${s.cpfLifeMonthly > 0 ? 'your override' : 'auto-estimated'}, ` : ''}fixed nominal from 65 = conservative) offsets expenses, stepping the amber line down.
            Projection compounds at {s.expectedReturn}%/yr nominal + S${s.monthlyContribution}/mo contributions; shaded band = ∓2pp return.
            {s.cpf.includeInPlan && <> CPF simulated on official 2026 rules (allocation by age, OA {window.FireMath.CPF.OA_RATE}% / SMRA {window.FireMath.CPF.SMRA_RATE}% + extra interest, MA capped at BHS, SA closes at 55 with RA set to your cohort FRS ≈ {fmtSgdCompact(window.FireMath.frsAt((s.birthYear || 0) + 55))}); OA joins your assets at 55 (kept at OA rates = conservative), SA/MA are never counted spendable.</>}
            {' '}A projection is an assumption, not a promise.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="dd-section-label">Your numbers (SGD)</div>
          {source !== 'server' && (
            <div className="mono" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--warn, #f59e0b)', border: '1px solid var(--warn, #f59e0b)', padding: '6px 8px', opacity: 0.9 }}>
              {source === 'local' && 'The server has no saved settings — showing this device’s copy. Hit Save to store them server-side.'}
              {source === 'local-offline' && 'Couldn’t reach the server — showing this device’s copy.'}
              {source === 'defaults' && 'No saved settings found (server or device) — these are defaults. Key in your numbers and hit Save.'}
            </div>
          )}
          {num('monthlyExpenses', 'Monthly expenses')}
          {num('swr', 'Safe withdrawal rate %')}
          {num('inflation', 'Inflation %/yr')}
          {num('expectedReturn', 'Expected return %/yr')}
          {num('monthlyContribution', 'Monthly contribution (investments)')}
          {num('otherAssetsSGD', 'Other liquid assets')}
          {num('birthYear', age != null ? `Birth year (age ${age})` : 'Birth year', '1')}
          <div className="dd-section-label" style={{ marginTop: 4 }}>CPF</div>
          {num('oa', 'OA balance', 'any', true)}
          {num('sa', 'SA balance', 'any', true)}
          {num('ma', 'MA balance', 'any', true)}
          {num('monthlyContribution', 'CPF inflow /mo (you + employer)', 'any', true)}
          {num('cpfLifeMonthly', 'CPF Life override (/mo, 0 = auto)')}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--fg-2)' }}>
            <input type="checkbox" checked={!!s.cpf.includeInPlan} onChange={e => setCpf('includeInPlan', e.target.checked)} />
            Model CPF in the plan — OA joins your assets at 55, RA pays CPF Life from 65
          </label>
          {cpfBand && s.cpf.monthlyContribution > 0 && (
            <div className="mono dim" style={{ fontSize: 9, lineHeight: 1.5 }}>
              At {age}, S${s.cpf.monthlyContribution}/mo splits OA S${(s.cpf.monthlyContribution * cpfBand[1]).toFixed(0)}
              {' '}· SA S${(s.cpf.monthlyContribution * cpfBand[2]).toFixed(0)}
              {' '}· MA S${(s.cpf.monthlyContribution * cpfBand[3]).toFixed(0)}.
              {cpfSim && cpfSim.raAt65 != null && s.cpfLifeMonthly <= 0 && (
                <> RA at 65 ≈ {fmtSgdCompact(cpfSim.raAt65)} → CPF Life ≈ S${Math.round(cpfSim.lifeMonthly)}/mo (auto).</>
              )}
            </div>
          )}
          <button className="btn" onClick={save} disabled={saveState === 'busy'} style={{ marginTop: 6 }}>
            {saveState === 'busy' ? 'Saving…' : saveState === 'saved' ? '✓ Saved to server' : saveState === 'err' ? 'Failed — retry' : 'Save'}
          </button>
          {saveState === 'err' && saveErr && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--neg, #ef4444)', lineHeight: 1.5 }}>{saveErr}</div>
          )}
          <div className="mono dim" style={{ fontSize: 9, lineHeight: 1.5 }}>
            A quarterly grounded check reviews these assumptions (SG inflation, CPF rates, CPF Life) and pings Telegram if any look stale. It never edits them — you do.
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, {
  _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry, RRChip,
  holdLabel, gradeForResult, DDResultFull, normalizeScoutCard, FireChart, FireBody, fmtSgdCompact,
  NewsUtils: { NEWS_PERIOD_SECS, parseAgoMs, newsEffectiveTs, decayImp, applyNewsFilters },
});
})();
