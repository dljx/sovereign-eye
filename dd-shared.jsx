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
    analyzedAt: s.analyzed_at || '',
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

Object.assign(window, {
  _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry, RRChip,
  holdLabel, gradeForResult, DDResultFull, normalizeScoutCard,
  NewsUtils: { NEWS_PERIOD_SECS, parseAgoMs, newsEffectiveTs, decayImp, applyNewsFilters },
});
})();
