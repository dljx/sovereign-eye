/* global React, window */
// Shared DD helpers used by BOTH desktop-panels.jsx and mobile.jsx. Loaded as a
// <script type="text/babel"> before them; exposes globals via window (same pattern
// as components.jsx) so the two platforms can't drift apart.
(function () {

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

Object.assign(window, { _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry, RRChip });
})();
