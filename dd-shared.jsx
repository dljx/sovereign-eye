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
    // Next earnings within 14d of the analysis (dd-side stamp) — a fresh BUY
    // this close to a report is a pre-earnings bet and gets flagged.
    earningsInDays: Number.isFinite(Number(s.earnings_in_days)) && s.earnings_in_days != null
      ? Number(s.earnings_in_days) : null,
    // Entry-time factor stamp (mom/quality/roic/fcf_yield/regime) — carried on
    // every card since v3, never rendered until 2026-07-11 (audit).
    factors: s.factors && typeof s.factors === 'object' ? s.factors : null,
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
      <WhyThisScore result={data} />
      <EvidenceSection dossier={data._dossier} />
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

// =============================================================
// WHY THIS SCORE — per-agent pillar decomposition + moderator adjustments.
// Computed on every debate and dropped on the floor until 2026-07-11 (audit:
// score_decomposition/score_adjustments had zero render sites).
// =============================================================
const _EV_PILLARS = [
  ['structural_moat', 'Moat'], ['fundamental_quality', 'Quality'],
  ['valuation_gap', 'Value gap'], ['catalyst_risk', 'Catalyst risk'],
  ['market_structure', 'Mkt structure'],
];

function WhyThisScore({ result }) {
  const dec = result.score_decomposition;
  const adj = result.score_adjustments;
  const agents = dec && typeof dec === 'object'
    ? Object.entries(dec).filter(([, b]) => b && typeof b === 'object') : [];
  const steps = adj && typeof adj === 'object'
    ? Object.entries(adj).filter(([, v]) => v && typeof v === 'object' && v.result != null) : [];
  if (!agents.length && !steps.length) return null;
  return (
    <div className="dd-section">
      <div className="dd-section-label">Why this score</div>
      {agents.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="sb-heat">
            <thead><tr><th></th>{_EV_PILLARS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>
              {agents.map(([agent, b]) => (
                <tr key={agent}>
                  <td className="k">{agent}</td>
                  {_EV_PILLARS.map(([k]) => (
                    <td key={k} className={b[k] == null ? 'empty' : ''}>
                      {b[k] == null ? '·' : Number(b[k]).toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {steps.length > 0 && (
        <div className="mono dim" style={{ fontSize: 10, lineHeight: 1.7, marginTop: 6 }}>
          {typeof adj.raw === 'number' && <span>raw {adj.raw.toFixed(2)}</span>}
          {steps.map(([name, v]) => (
            <span key={name}> → {name.replace(/_/g, ' ')} {Number(v.result).toFixed(2)}</span>
          ))}
          {typeof adj.final === 'number' && <b> → final {adj.final.toFixed(2)}</b>}
        </div>
      )}
    </div>
  );
}

// =============================================================
// EVIDENCE — the raw dossier the agents argued over. It has always shipped to
// the browser inside dd:<TICKER> and was never displayed (2026-07-11 audit:
// ~15 rich sections dormant). Guarded per-field: older dossiers lack pieces.
// =============================================================
function EvRow({ k, v, title }) {
  if (v == null || v === '') return null;
  return (
    <div className="ev-row" title={title}>
      <span className="ev-k">{k}</span><span className="ev-v">{v}</span>
    </div>
  );
}

function EvidenceSection({ dossier }) {
  const [open, setOpen] = useState(false);
  if (!dossier || typeof dossier !== 'object') return null;
  const tech = dossier.technicals || {};
  const ratios = (dossier.financials || {}).ratios_ttm || {};
  const av = dossier.av_overview || {};
  const ins = dossier.insiders || {};
  const mspr = dossier.insider_sentiment_mspr || {};
  const rec = dossier.recommendation_trends || {};
  const peers = Array.isArray(dossier.peer_comps) ? dossier.peer_comps.filter(p => p && p.ticker) : [];
  const surp = Array.isArray(dossier.earnings_surprises) ? dossier.earnings_surprises : [];
  const gov = dossier.government_contracts || {};
  const macro = dossier.macro || {};
  const dq = dossier.data_quality || {};
  const price = (dossier.quote || {}).price;

  const n = (v, d = 1) => (v == null || !isFinite(v) ? null : Number(v).toFixed(d));
  const pctFrac = v => (v == null ? null : `${(v * 100).toFixed(1)}%`);
  const usd = v => (v == null ? null : `$${Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1e3) + 'k'}`);
  const wacc = ratios.wacc;
  const roicSpread = ratios.roic != null && wacc != null
    ? `${n(ratios.roic)}% vs WACC ${n(wacc * 100)}% (${n(ratios.roic - wacc * 100)}pp)` : n(ratios.roic) && `${n(ratios.roic)}%`;
  const targetUpside = av.analyst_target_price != null && price > 0
    ? ` (${((av.analyst_target_price / price - 1) * 100).toFixed(0)}% vs px)` : '';

  return (
    <div className="dd-section">
      <div className="dd-section-label dd-transcript-toggle" onClick={() => setOpen(v => !v)}>
        {open ? '▼' : '▶'} Evidence — the data behind the debate
      </div>
      {open && (
        <div className="ev-grid">
          <div>
            <div className="ev-h">Technicals</div>
            <EvRow k="Price vs SMA200" v={tech.above_sma200 != null ? (tech.above_sma200 ? 'above' : 'below') : null} />
            <EvRow k="RSI 14" v={n(tech.rsi_14)} />
            <EvRow k="MACD" v={tech.macd_bullish != null ? (tech.macd_bullish ? 'bullish' : 'bearish') : null} />
            <EvRow k="From 52w high" v={tech.pct_from_52w_high != null ? `${tech.pct_from_52w_high}%` : null} />
            <EvRow k="Momentum 12-1" v={pctFrac(tech.mom_12_1)} />
            <EvRow k="Momentum 6m / 1m" v={tech.mom_6m != null || tech.mom_1m != null ? `${pctFrac(tech.mom_6m) || '·'} / ${pctFrac(tech.mom_1m) || '·'}` : null} />
          </div>
          <div>
            <div className="ev-h">Quality & valuation</div>
            <EvRow k="ROIC" v={roicSpread} title="Return on invested capital vs cost of capital — the spread is the compounding engine" />
            <EvRow k="FCF yield" v={pctFrac(ratios.fcf_yield)} />
            <EvRow k="Rule of 40" v={n(ratios.rule_of_40)} />
            <EvRow k="Gross / net margin" v={ratios.gross_margin != null || ratios.net_margin != null ? `${n(ratios.gross_margin) ?? '·'}% / ${n(ratios.net_margin) ?? '·'}%` : null} />
            <EvRow k="PE / fwd PE" v={ratios.pe != null || ratios.fwd_pe != null ? `${n(ratios.pe) ?? '·'} / ${n(ratios.fwd_pe) ?? '·'}` : null} />
            <EvRow k="Fwd PEG" v={n(ratios.fwd_peg, 2)} />
            <EvRow k="EPS revision momentum" v={pctFrac(ratios.eps_revision_momentum)} title="30-day change in consensus NTM EPS" />
            <EvRow k="Debt/equity" v={n(ratios.debt_equity)} />
            <EvRow k="Short %" v={ratios.short_pct != null ? `${n(ratios.short_pct)}%` : null} />
          </div>
          <div>
            <div className="ev-h">Street & insiders</div>
            <EvRow k="Analyst target" v={av.analyst_target_price != null ? `$${n(av.analyst_target_price, 2)}${targetUpside}` : null} />
            <EvRow k="Rec trend" v={rec.strong_buy != null ? `${(rec.strong_buy || 0) + (rec.buy || 0)} buy · ${rec.hold || 0} hold · ${(rec.sell || 0) + (rec.strong_sell || 0)} sell` : null} title={rec.period ? `Period ${rec.period}` : undefined} />
            <EvRow k="Insider net (12m)" v={ins.net_insider_usd != null && (ins.buy_count || ins.sell_count) ? usd(ins.net_insider_usd) : null} />
            <EvRow k="Cluster buying" v={ins.cluster_buying ? `yes — ${ins.significant_buys || 0} significant buys` : null} title="≥2 distinct insiders buying within 14 days" />
            <EvRow k="MSPR 3m avg" v={n(mspr.avg_mspr_3m)} title="Insider sentiment: positive = net buying pressure" />
            <EvRow k="Gov contracts" v={gov.count ? `${gov.count} · ${usd(gov.total_value)}` : null} />
            <EvRow k="Div yield / PEG" v={av.dividend_yield != null || av.peg_ratio != null ? `${pctFrac(av.dividend_yield) ?? '·'} / ${n(av.peg_ratio, 2) ?? '·'}` : null} />
            <EvRow k="Qtr rev growth YoY" v={pctFrac(av.quarterly_revenue_growth_yoy)} />
          </div>
          {surp.length > 0 && (
            <div>
              <div className="ev-h">Earnings surprises (last {Math.min(surp.length, 8)}q)</div>
              <div className="ev-surp">
                {surp.slice(0, 8).map((s, i) => (
                  <span key={i}
                    className={`ev-q ${s.beat_quality === 'MISS' ? 'neg' : s.beat_quality ? 'pos' : ''}`}
                    title={`${s.date || ''} · EPS ${s.reported_eps ?? '?'} vs est ${s.estimated_eps ?? '?'} (${s.surprise_pct ?? '?'}%)${s.beat_quality === 'LARGE_BEAT' ? ' — >50% beat: often one-time items' : ''}`}>
                    {s.beat_quality === 'LARGE_BEAT' ? '‼' : s.beat_quality === 'BEAT' ? '▲' : s.beat_quality === 'MISS' ? '▼' : '·'}
                  </span>
                ))}
              </div>
            </div>
          )}
          {peers.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="ev-h">Peer comps</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="sb-heat">
                  <thead><tr><th></th><th>PE</th><th>fwd PE</th><th>EV/EBITDA</th><th>rev gr</th><th>GM</th></tr></thead>
                  <tbody>
                    {peers.map(p => (
                      <tr key={p.ticker}>
                        <td className="k">{p.ticker}</td>
                        <td>{p.pe || '·'}</td><td>{p.fwd_pe || '·'}</td>
                        <td>{p.ev_ebitda || '·'}</td><td>{p.rev_growth != null ? `${p.rev_growth}%` : '·'}</td>
                        <td>{p.gross_margin != null ? `${p.gross_margin}%` : '·'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="mono dim" style={{ fontSize: 10, lineHeight: 1.6 }}>
              {macro.regime && <span>Macro regime: {macro.regime}. </span>}
              {dq.data_confidence && <span>Data confidence: {dq.data_confidence}. </span>}
              {Array.isArray(dq.warnings) && dq.warnings.length > 0 &&
                <span>⚠ {dq.warnings.length} data warning(s): {dq.warnings.slice(0, 3).join(' · ')}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
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
  const [navIncome, setNavIncome] = useState(null);  // broker income rows (USD)
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
        if (Array.isArray(d?.income) && d.income.length) setNavIncome(d.income);
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
          {navIncome && (() => {
            // Broker cash line items (IBKR Flex, trailing statement window),
            // bucketed. USD at today's rate — indicative, not accounting.
            const buckets = { div: 0, wht: 0, fees: 0, interest: 0, other: 0 };
            for (const r of navIncome) {
              const t = (r.type || '').toLowerCase();
              if (t.includes('dividend')) buckets.div += r.amount;
              else if (t.includes('withholding') || t.includes('tax')) buckets.wht += r.amount;
              else if (t.includes('fee') || t.includes('commission')) buckets.fees += r.amount;
              else if (t.includes('interest')) buckets.interest += r.amount;
              else buckets.other += r.amount;
            }
            const sgd = v => fmtSgdCompact(v * sgdRate);
            const net = buckets.div + buckets.wht + buckets.fees + buckets.interest + buckets.other;
            return (
              <div style={{ marginTop: 10 }}>
                <div className="dd-section-label">Portfolio income · last 12m (broker-reported)</div>
                <div className="mono" style={{ fontSize: 10, lineHeight: 1.8, color: 'var(--fg-2)' }}>
                  Dividends {sgd(buckets.div)}
                  {buckets.interest !== 0 && <> · Interest {sgd(buckets.interest)}</>}
                  {buckets.wht !== 0 && <> · Withholding {sgd(buckets.wht)}</>}
                  {buckets.fees !== 0 && <> · Fees {sgd(buckets.fees)}</>}
                  {buckets.other !== 0 && <> · Other {sgd(buckets.other)}</>}
                  {' '}· <span style={{ color: net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>Net {sgd(net)}</span>
                </div>
              </div>
            );
          })()}
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

// =============================================================
// ATTRIBUTION HEATMAP — factor buckets × forward windows
// Cell = mean excess vs benchmark; n<10 cells render grey ("thin") because
// they're too small to read — the greying IS the feature. No cell is
// actionable until the pre-registered scoreboard reads (see sovereign-dd
// docs/ADAPTATION_PROTOCOL.md).
// =============================================================
const _HEAT_DIMS = [
  ['verdict',     'Gate verdict'],
  ['mom_12_1',    'Momentum 12-1'],
  ['quality',     'Quality'],
  ['eps_rev_mom', 'EPS revisions'],
  ['fcf_yield',   'FCF yield'],
  ['roic',        'ROIC'],
  ['regime',      'Macro regime'],
];

function AttributionHeatmap({ sb }) {
  const windows = (sb?.windows || []).filter(w => w.overall);
  if (!windows.length) return null;

  const dims = _HEAT_DIMS.map(([key, label]) => {
    const vals = [];
    for (const w of windows) {
      for (const r of (w.buckets?.[key] || [])) {
        if (r.k !== 'n/a' && !vals.includes(r.k)) vals.push(r.k);
      }
    }
    return { key, label, vals };
  }).filter(d => d.vals.length > 1); // a one-value dimension can't attribute anything
  if (!dims.length) return null;

  const cell = (w, key, k) => (w.buckets?.[key] || []).find(r => r.k === k) || null;
  const shade = mean => { // color intensity capped at ±10% excess
    const a = Math.min(Math.abs(mean) / 0.10, 1) * 0.5;
    return mean >= 0 ? `rgba(52,211,153,${a})` : `rgba(251,113,133,${a})`;
  };

  return (
    <div className="sb-section">
      <div className="dd-section-label"
        title="Mean excess return vs the benchmark per factor bucket × forward window. Grey cells have n<10 signals — too few to read. Nothing here is actionable until the pre-registered scoreboard reads.">
        Attribution × windows · mean excess
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="sb-heat">
          <thead>
            <tr><th></th>{windows.map(w => <th key={w.weeks}>{w.weeks}W</th>)}</tr>
          </thead>
          <tbody>
            {dims.map(d => [
              <tr className="dim" key={d.key + '-hdr'}>
                <td colSpan={windows.length + 1}>{d.label}</td>
              </tr>,
              ...d.vals.map(k => (
                <tr key={d.key + '-' + k}>
                  <td className="k">{k}</td>
                  {windows.map(w => {
                    const c = cell(w, d.key, k);
                    if (!c) return <td key={w.weeks} className="empty">·</td>;
                    const thin = c.n < 10;
                    return (
                      <td key={w.weeks} className={thin ? 'thin' : ''}
                        style={thin ? undefined : { background: shade(c.mean) }}
                        title={`${d.label} · ${k} · ${w.weeks}w — n=${c.n}, hit ${(c.hit * 100).toFixed(0)}%, mean ${(c.mean * 100).toFixed(1)}%, median ${(c.median * 100).toFixed(1)}%${thin ? ' — n<10: too few to read' : ''}`}>
                        {(c.mean * 100).toFixed(1)}%
                        <span className="hn">n{c.n}</span>
                      </td>
                    );
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, {
  _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry, RRChip,
  holdLabel, gradeForResult, DDResultFull, normalizeScoutCard, FireChart, FireBody, fmtSgdCompact,
  AttributionHeatmap,
  NewsUtils: { NEWS_PERIOD_SECS, parseAgoMs, newsEffectiveTs, decayImp, applyNewsFilters },
});
})();
