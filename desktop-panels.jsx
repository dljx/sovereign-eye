/* global React, window, Icon, SrcPill, Sparkline, AgentPixel, MacroChart, Treemap,
   fmtUSD, fmtUSDC, fmtMoney, fmtPct, fmtAbs, fmtVol, sign, normQ,
   POSITIONS, QUOTES, SYNTHESIS, NEWS_PORTFOLIO, NEWS_WIRE, SEC_FILINGS,
   DD_RESULT, SCOUTS, MACRO_SERIES, SPARKS, computeTotals, ddForTicker, API_HEALTH */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// =============================================================
// HOLDINGS PANEL
// =============================================================
function HoldingsPanel({ positions, quotes, totals, sortKey, sortDir, onSort, onHover, onLeave, hoveredTk }) {
  const enriched = useMemo(() => positions.map(p => {
    const q = quotes[p.ticker] || {};
    const mv = (q.px || 0) * p.qty;
    const upnl = ((q.px || 0) - p.avg) * p.qty;
    const upnlPct = p.avg > 0 ? ((q.px || 0) / p.avg - 1) * 100 : 0;
    const weight = totals.nlv > 0 ? (mv / totals.nlv) * 100 : 0;
    return { ...p, ...q, mv, upnl, upnlPct, weight };
  }), [positions, quotes, totals]);

  const sorted = useMemo(() => {
    const arr = [...enriched];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? (av - bv) : (bv - av);
    });
    return arr;
  }, [enriched, sortKey, sortDir]);

  const Sort = ({ k, children, align }) => (
    <th onClick={() => onSort(k)} className={sortKey === k ? 'sorted' : ''} style={{ textAlign: align || 'right' }}>
      {children}
      <span className="sort">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '·'}</span>
    </th>
  );

  return (
    <table className="holdings-table">
      <thead>
        <tr>
          <Sort k="ticker" align="left">Ticker</Sort>
          <th style={{ textAlign: 'left' }}>Broker</th>
          <Sort k="qty">Qty</Sort>
          <Sort k="avg">Avg</Sort>
          <Sort k="px">Last</Sort>
          <Sort k="dPct">Day%</Sort>
          <th>Spark</th>
          <Sort k="mv">Value</Sort>
          <Sort k="upnlPct">U/PnL%</Sort>
          <Sort k="weight">Weight</Sort>
        </tr>
      </thead>
      <tbody>
        {sorted.map(p => (
          <tr key={p.ticker}
              onMouseEnter={() => onHover && onHover(p)}
              onMouseLeave={() => onLeave && onLeave()}
              style={hoveredTk === p.ticker ? { background: 'var(--bg-2)' } : null}>
            <td>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="tk">{p.ticker}</span>
                <span className="nm">{p.name}</span>
              </div>
            </td>
            <td style={{ textAlign: 'left' }}>
              <span className={`broker-tag ${(p.broker || '').toLowerCase()}`}>{p.broker}</span>
            </td>
            <td className="dim">{p.qty}</td>
            <td className="dim">{fmtUSD(p.avg)}</td>
            <td>{fmtUSD(p.px || 0)}</td>
            <td className={sign(p.dPct)}>{fmtPct(p.dPct || 0)}</td>
            <td><Sparkline data={window.SPARKS?.[p.ticker]} w={56} h={16} /></td>
            <td>{fmtUSDC(p.mv)}</td>
            <td className={sign(p.upnlPct)}>{fmtPct(p.upnlPct, 1)}</td>
            <td>
              <span className="weight-bar"><i style={{ width: `${Math.min(100, p.weight * 4)}%` }} /></span>
              <span className="dim">{p.weight.toFixed(1)}%</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// =============================================================
// HEATMAP PANEL
// =============================================================
function HeatmapPanel({ positions, quotes, totals }) {
  const items = useMemo(() => positions.map(p => {
    const q = quotes[p.ticker] || {};
    const mv = (q.px || 0) * p.qty;
    return { tk: p.ticker, name: p.name, weight: totals.nlv > 0 ? mv / totals.nlv : 0, pct: q.dPct || 0 };
  }), [positions, quotes, totals]);

  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 520, h: 360 });
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        if (cr.width > 0 && cr.height > 0) setDims({ w: cr.width, h: cr.height });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: 360 }}>
      <Treemap items={items} width={dims.w} height={dims.h} />
    </div>
  );
}

// =============================================================
// INTEL FEED PANEL — with live /api/synthesis fetch
// =============================================================
function IntelPanel() {
  const [tab, setTab] = useState('catalysts');
  const [liveData, setLiveData] = useState(null);
  const [src, setSrc] = useState('seed');

  useEffect(() => {
    const tickers = (window.POSITIONS || []).map(p => p.ticker).filter(Boolean);
    if (!tickers.length) { setSrc('seed'); return; }
    const qs = tickers.join(',');
    const load = () =>
      fetch(`/api/synthesis?tickers=${qs}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d && (d.catalysts || d.risks || d.macro)) {
            setLiveData(d);
            setSrc(d.cached ? 'cached' : 'live');
          } else {
            setSrc('seed');
          }
        })
        .catch(() => setSrc('seed'));
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => {
    if (liveData?.[tab]) {
      return liveData[tab].map(item => {
        if (typeof item === 'string') return { tag: tab.slice(0,4).toUpperCase(), body: item, meta: '' };
        return { tag: item.tag || tab.slice(0,4).toUpperCase(), body: item.body || item.text || '', meta: item.meta || '' };
      });
    }
    return (window.SYNTHESIS?.[tab] || []);
  }, [liveData, tab]);

  const age = src === 'live' ? 'now' : src === 'cached' ? 'cached' : 'seed';

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">03</span> Intelligence Feed</div>
        <div className="tabs">
          {['catalysts','risks','macro'].map(k => (
            <span key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {k} <span className="count">{(liveData?.[k] || window.SYNTHESIS?.[k] || []).length}</span>
            </span>
          ))}
        </div>
        <div className="panel-actions">
          <SrcPill src={src} age={age} />
        </div>
      </div>
      <div className="panel-body">
        <div className="intel-list">
          {src === 'seed' && !liveData && items.length === 0 ? (
            [1,2,3].map(i => (
              <div className="intel-item" key={i}>
                <div className="intel-num">0{i}</div>
                <div style={{ width: '100%' }}>
                  <div className="shimmer" style={{ height: 12, width: '85%', marginBottom: 6 }} />
                  <div className="shimmer" style={{ height: 10, width: '65%' }} />
                </div>
              </div>
            ))
          ) : items.map((it, i) => (
            <div className="intel-item" key={i}>
              <div className="intel-num">0{i + 1}</div>
              <div>
                <div className="intel-body">
                  <span className="tag">{it.tag}</span>
                  {it.body}
                </div>
                {it.meta && <div className="intel-meta">{it.meta}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// =============================================================
// NEWS PANEL
// =============================================================
function NewsPanel() {
  const [tab, setTab] = useState('portfolio');
  const list = tab === 'portfolio' ? (window.NEWS_PORTFOLIO || []) : (window.NEWS_WIRE || []);
  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">04</span> News</div>
        <div className="tabs">
          <span className={`tab ${tab === 'portfolio' ? 'active' : ''}`} onClick={() => setTab('portfolio')}>
            Portfolio <span className="count">{(window.NEWS_PORTFOLIO || []).length}</span>
          </span>
          <span className={`tab ${tab === 'wire' ? 'active' : ''}`} onClick={() => setTab('wire')}>
            Wire <span className="count">{(window.NEWS_WIRE || []).length}</span>
          </span>
        </div>
        <div className="panel-actions">
          <SrcPill src="seed" age="now" />
        </div>
      </div>
      <div className="panel-body">
        <div className="news-list">
          {list.map((n, i) => (
            <div className="news-item" key={i}>
              <div>
                <div className={`news-tk ${n.macro ? 'macro' : ''}`}>{n.tk}</div>
              </div>
              <div>
                <div className="news-headline">{n.headline}</div>
                <div className="news-meta">{n.src}</div>
              </div>
              <div className="news-time">{n.t}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// =============================================================
// MACRO CHART PANEL
// =============================================================
function MacroPanel() {
  const wrap = useRef(null);
  const [w, setW] = useState(360);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const ms = window.MACRO_SERIES || { nav: [], spx: [] };
  const lastNav = ms.nav[ms.nav.length - 1] || 100;
  const lastSpx = ms.spx[ms.spx.length - 1] || 100;
  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">05</span> Macro Correlation</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>14M · MONTHLY</span>
          <SrcPill src="seed" age="seed" />
        </div>
      </div>
      <div className="panel-body">
        <div className="chart-legend">
          <span><span className="dot" style={{ background: 'var(--acc)' }} /> NAV · {lastNav.toFixed(1)} ({(lastNav - 100).toFixed(1)}%)</span>
          <span><span className="dot" style={{ background: 'var(--fg-3)' }} /> SPX · {lastSpx.toFixed(1)} ({(lastSpx - 100).toFixed(1)}%)</span>
        </div>
        <div ref={wrap} className="chart-wrap">
          <MacroChart nav={ms.nav} spx={ms.spx} w={w || 360} h={200} />
        </div>
      </div>
    </>
  );
}

// =============================================================
// SEC FILINGS PANEL — with live Finnhub fetch
// =============================================================
const _MEANINGFUL_FORMS = new Set(['8-K','10-Q','10-K','S-1','DEF 14A','6-K','10-K/A','8-K/A']);

function FilingsPanel() {
  const [rows, setRows] = useState(null);
  const [src, setSrc] = useState('loading');

  useEffect(() => {
    const tickers = (window.POSITIONS || []).map(p => p.ticker).filter(Boolean);
    const apiKey = window.SE_CONFIG?.CONFIG?.FINNHUB_API_KEY;
    if (!tickers.length || !apiKey) { setSrc('seed'); return; }

    const seedMap = {};
    (window.SEC_FILINGS || []).forEach(f => {
      if (!seedMap[f.tk]) seedMap[f.tk] = { tldr: f.tldr, sent: f.sent };
    });

    Promise.all(
      tickers.slice(0, 8).map(t =>
        fetch(`https://finnhub.io/api/v1/stock/filings?symbol=${t}&token=${apiKey}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const live = [];
      tickers.slice(0, 8).forEach((t, i) => {
        if (!Array.isArray(results[i])) return;
        results[i]
          .filter(f => _MEANINGFUL_FORMS.has(f.form))
          .slice(0, 2)
          .forEach(f => live.push({
            form: f.form,
            tk: t,
            tldr: seedMap[t]?.tldr || '—',
            sent: seedMap[t]?.sent || 'neutral',
            when: (f.filedDate || f.reportDate || '').slice(0, 10),
          }));
      });
      if (live.length) {
        live.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
        setRows(live.slice(0, 10));
        setSrc('live');
      } else {
        setSrc('seed');
      }
    }).catch(() => setSrc('seed'));
  }, []);

  const display = rows || (window.SEC_FILINGS || []);

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">06</span> SEC Tracker</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>{display.length} RECENT</span>
          <SrcPill src={src === 'loading' ? 'cached' : src} age={src === 'loading' ? '…' : 'now'} />
        </div>
      </div>
      <div className="panel-body">
        <div className="filings-list">
          {display.map((f, i) => (
            <div className="filing-item" key={i}>
              <span className="filing-form">{f.form}</span>
              <span className="filing-tk">{f.tk}</span>
              <span className="filing-tldr">{f.tldr}</span>
              <span className={`sent ${f.sent}`}>{f.sent}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// =============================================================
// SOVEREIGN DD PANEL — real SSE polling + design visuals
// =============================================================
function _fmtElapsed(s) {
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

// Map real agent labels/ids → design agent kinds for AgentPixel
const _AGENT_KINDS = {
  Valuation:       'valuation',
  Macro:           'macro',
  TechAnalysis:    'techanalysis',
  FundForensics:   'fundforensics',
  MarketStructure: 'marketstructure',
};

const _DESIGN_AGENTS = [
  { name: 'Valuation',       k: 'valuation' },
  { name: 'Macro',           k: 'macro' },
  { name: 'TechAnalysis',    k: 'techanalysis' },
  { name: 'FundForensics',   k: 'fundforensics' },
  { name: 'MarketStructure', k: 'marketstructure' },
];

// Map real sovereign-dd agent names → design agent names
const _AGENT_NAME_MAP = {
  StructuralEdge: 'Valuation', FundamentalForensics: 'FundForensics',
  ValuationEngine: 'Macro', CatalystHunter: 'TechAnalysis',
  MarketStructure: 'MarketStructure',
  MOAT: 'Valuation', FUND: 'FundForensics', VAL: 'Macro',
  CATL: 'TechAnalysis', MKT: 'MarketStructure',
};

function _mapDDResult(data) {
  if (!data) return null;
  const d = data.result || data;
  const score = d.consensus_score ?? d.score ?? 0;
  const rawGrade = (d.consensus_grade ?? d.grade ?? 'HOLD').trim();
  const grade = rawGrade.toUpperCase();
  const agents = (d.agents || []).map(a => {
    const rawVote = (a.signal ?? a.vote ?? a.stance ?? 'HOLD').toUpperCase();
    const vote = ['BUY','STRONG BUY','STRONG-BUY','BULL'].includes(rawVote) ? 'BULL'
      : ['SELL','BEAR'].includes(rawVote) ? 'BEAR' : 'NEUTRAL';
    return {
      name: a.role ?? a.agent ?? a.name ?? 'Agent',
      vote,
      rationale: a.rationale ?? a.note ?? a.commentary ?? a.text ?? '',
    };
  });
  return {
    ticker: d.ticker || '',
    score, grade,
    confidence: d.confidence ?? 'MEDIUM',
    asOf: d.asOf || 'now',
    thesis: d.majority_thesis ?? d.thesis ?? '',
    swing: d.key_swing_factor ?? d.swing ?? '',
    dissent: d.dissent ?? '',
    agents,
  };
}

function DDPanel({ onTickerSelect }) {
  const [state, setState] = useState('idle'); // idle | loading | result
  const [input, setInput] = useState('AVGO');
  const [ticker, setTicker] = useState(null);
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [agentStates, setAgentStates] = useState({});
  const [log, setLog] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);
  const [errMsg, setErrMsg] = useState('');

  const pollRef = useRef(null);
  const elapsedRef = useRef(null);
  const livePollRef = useRef(null);
  const liveCountRef = useRef(0);
  const startRef = useRef(0);
  const logRef = useRef(null);

  const stopAll = useCallback(() => {
    if (pollRef.current)    { clearInterval(pollRef.current);    pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (livePollRef.current){ clearInterval(livePollRef.current); livePollRef.current = null; }
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const launch = useCallback(async () => {
    const tk = input.trim().toUpperCase();
    if (!tk) return;
    stopAll();
    setState('loading');
    setResult(null);
    setElapsed(0);
    setErrMsg('');
    setTicker(tk);
    setLog([{ who: 'SYSTEM', text: `[${tk}] Initializing 5-agent debate room.`, dim: true }]);
    setAgentStates({});
    setLiveEvents([]);
    liveCountRef.current = 0;
    startRef.current = Date.now();

    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    try {
      await fetch('/api/dd/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: tk }),
      });
    } catch { /* trigger may fail; still poll */ }

    const doPoll = async () => {
      try {
        const r = await fetch(`/api/dd/${tk.toLowerCase()}`);
        if (r.ok) {
          const data = await r.json();
          const d = data?.result || data;
          if (data && (d.consensus_score != null || d.score != null)) {
            stopAll();
            const mapped = _mapDDResult(data);
            if (mapped) { setResult(mapped); setState('result'); }
          }
        }
      } catch {}
    };

    setTimeout(() => {
      doPoll();
      pollRef.current = setInterval(doPoll, 15_000);
    }, 5_000);

    const doLivePoll = async () => {
      try {
        const r = await fetch(`/api/dd/live/${tk.toLowerCase()}?after=${liveCountRef.current}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.events?.length) {
          const newEvents = data.events;
          setLiveEvents(prev => [...prev, ...newEvents]);
          liveCountRef.current += newEvents.length;

          // Build log lines + agent state updates from live events
          newEvents.forEach(ev => {
            const agentId = ev.agent || ev.who || '';
            const designName = _AGENT_NAME_MAP[agentId] || agentId;
            const text = ev.text || ev.message || ev.content || JSON.stringify(ev);
            if (ev.type === 'CONSENSUS' || ev.type === 'DOSSIER_START') {
              setLog(L => [...L, { who: 'SYSTEM', text, dim: true }]);
            } else if (designName && designName !== agentId) {
              setLog(L => [...L, { who: designName, text }]);
              setAgentStates(s => ({ ...s, [designName]: 'thinking' }));
            } else if (ev.type === 'R3_DELTA' || ev.type === 'FETCH_DONE') {
              Object.keys(_AGENT_KINDS).forEach(n => {
                setAgentStates(s => ({ ...s, [n]: s[n] === 'thinking' ? 'done' : s[n] }));
              });
            }
          });

          if (data.done) {
            clearInterval(livePollRef.current);
            livePollRef.current = null;
            doPoll();
          }
        }
      } catch {}
    };
    livePollRef.current = setInterval(doLivePoll, 5_000);
  }, [input, stopAll]);

  const loadFromKV = useCallback(async (tk) => {
    try {
      const r = await fetch(`/api/dd/${tk.toLowerCase()}`);
      if (!r.ok) return;
      const data = await r.json();
      const d = data?.result || data;
      if (data && (d.consensus_score != null || d.score != null)) {
        const mapped = _mapDDResult(data);
        if (mapped) { setResult(mapped); setState('result'); setTicker(tk); }
      }
    } catch {}
  }, []);

  // Try loading KV result for initial ticker
  useEffect(() => { loadFromKV('AVGO'); }, [loadFromKV]);

  const displayResult = result || (state === 'idle' ? window.DD_RESULT : null);

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">07</span> Sovereign DD</div>
        <div className="panel-actions">
          {state === 'result' && <SrcPill src="cached" age={displayResult?.asOf || 'now'} />}
          {state === 'loading' && <SrcPill src="live" age="debating" />}
          {state === 'idle'    && <SrcPill src="seed" />}
        </div>
      </div>
      <div className="panel-body">
        <div className="dd-input-row">
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            placeholder="TICKER"
            disabled={state === 'loading'}
            onKeyDown={e => e.key === 'Enter' && launch()}
          />
          <button className="btn btn-primary btn-lg" onClick={launch} disabled={state === 'loading' || !input.trim()}>
            {state === 'loading' ? 'Debating…' : 'Analyze'}
          </button>
          {state !== 'idle' && (
            <button className="btn btn-lg" onClick={() => { stopAll(); setState('idle'); setResult(null); }}>Reset</button>
          )}
        </div>

        {state === 'idle' && !displayResult && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
              {_DESIGN_AGENTS.map(a => (
                <div key={a.k} style={{ opacity: 0.4 }}><AgentPixel kind={a.k} /></div>
              ))}
            </div>
            <div className="mono uppercase" style={{ fontSize: 11, color: 'var(--fg-2)' }}>5 agents standing by</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>Enter a ticker and press Analyze to convene the debate room.</div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--fg-4)' }}>
              Try:{' '}
              {['AVGO','MU','VST'].map((t, i) => (
                <span key={t}>
                  {i > 0 && ' · '}
                  <button className="mono" style={{ color: 'var(--acc)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onClick={() => setInput(t)}>{t}</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="debate-room">
            <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--acc)', letterSpacing: '0.16em' }}>
              ▶ Debate Room — [{ticker}]
            </div>
            <div className="debate-grid">
              {_DESIGN_AGENTS.map(a => {
                const st = agentStates[a.name];
                return (
                  <div key={a.name} className={`agent ${st || ''}`}>
                    <div style={{ position: 'relative' }}>
                      <AgentPixel kind={a.k} talking={st === 'thinking'} />
                      {st === 'thinking' && <div className="agent-bubble">!</div>}
                    </div>
                    <div className="agent-name">{a.name}</div>
                    <div className="agent-status">
                      {st === 'thinking' ? 'thinking…' : st === 'done' ? '✓ done' : 'waiting'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div ref={logRef} className="debate-log">
              {log.map((l, i) => (
                <span key={i} className={`log-line ${l.dim ? 'dim' : ''}`}>
                  {l.who === 'SYSTEM'
                    ? <span className="you">[{l.who}]</span>
                    : <span className="who">[{l.who}]</span>
                  }{' '}{l.text}
                </span>
              ))}
            </div>
            <div className="debate-timer">
              <span>elapsed · {_fmtElapsed(elapsed)}</span>
              <span>{Object.values(agentStates).filter(v => v === 'done').length}/5 agents</span>
              <span>est · 5–10 min via GitHub Actions</span>
            </div>
            <div className="debate-progress">
              <i style={{ width: `${Math.min(100, (elapsed / 600) * 100)}%` }} />
            </div>
          </div>
        )}

        {(state === 'result' || (state === 'idle' && displayResult)) && displayResult && (
          <div>
            <div className="dd-result-header">
              <div>
                <div className="dd-ticker">{displayResult.ticker}</div>
                <div className="dd-conf">CONF: {displayResult.confidence}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="dd-score">{(+displayResult.score).toFixed(1)}<span className="denom"> / 10</span></div>
                <div className={`dd-grade ${displayResult.grade.toLowerCase().replace(/\s+/g, '-')}`}>{displayResult.grade}</div>
              </div>
            </div>
            <div className="dd-section">
              <div className="dd-section-label">Thesis</div>
              <div className="dd-thesis">{displayResult.thesis}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <div className="dd-section-label">Key Swing Factor</div>
                <div className="dd-swing">{displayResult.swing}</div>
              </div>
              {displayResult.dissent && (
                <div>
                  <div className="dd-section-label">Dissent</div>
                  <div className="dd-dissent">{displayResult.dissent}</div>
                </div>
              )}
            </div>
            {displayResult.agents?.length > 0 && (
              <div className="dd-section">
                <div className="dd-section-label">Agent Votes</div>
                <div className="dd-agents">
                  {displayResult.agents.map(a => (
                    <div key={a.name} className="dd-agent">
                      <div className="ag-name">{a.name}</div>
                      <div className={`ag-vote ${(a.vote || '').toLowerCase()}`}>{a.vote}</div>
                      <div className="ag-rationale">{a.rationale}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// =============================================================
// SOVEREIGN SCOUT PANEL — with live /api/dd/scouts fetch
// =============================================================
function ScoutPanel({ onPick }) {
  const [cards, setCards] = useState(null);
  const [src, setSrc] = useState('loading');

  useEffect(() => {
    fetch('/api/dd/scouts')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length) {
          // Normalize sovereign-dd scout shape → design shape
          const norm = d.map(s => ({
            tk: s.ticker || s.tk || '—',
            score: s.score ?? 0,
            grade: (s.grade ?? s.consensus_grade ?? 'HOLD').replace(/ /g, '-').toUpperCase(),
            sector: s.sector || '—',
            valPath: s.path || s.valPath || '—',
            rationale: s.gemma_rationale || s.rationale || s.thesis || '—',
            filters: s.matched_filters || s.filters || [],
          }));
          setCards(norm);
          setSrc('live');
        } else {
          setSrc('seed');
        }
      })
      .catch(() => setSrc('seed'));
  }, []);

  const display = cards || (window.SCOUTS || []);
  const age = src === 'live' ? 'now' : src === 'loading' ? '…' : 'seed';

  const nextRun = (() => {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return et.getHours() < 6 ? '06:00 ET today' : '06:00 ET tomorrow';
  })();

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">08</span> Sovereign Scout</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
            {display.length} BUY SIGNALS
          </span>
          <SrcPill src={src === 'loading' ? 'cached' : src} age={age} />
        </div>
      </div>
      <div className="panel-body">
        {src === 'loading' || (src === 'seed' && display.length === 0) ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
            <div className="mono uppercase" style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 8 }}>Scout is hunting</div>
            <div style={{ fontSize: 12 }}>Nightly screener · next run {nextRun}</div>
            <div style={{ marginTop: 6, fontSize: 11 }}>6 FMP lenses → Gemini triage → 5-agent debate</div>
          </div>
        ) : (
          <div className="scout-grid">
            {display.map((s, i) => (
              <div
                key={s.tk}
                className={`scout-card ${s.grade.toLowerCase().replace(' ','-')}${i === 0 ? ' featured' : ''}`}
                onClick={() => onPick && onPick(s.tk)}
                title={`Open DD for ${s.tk}`}
              >
                <div className="scout-card-top">
                  <span className="scout-tk">{s.tk}</span>
                  <span className="scout-score">{(+s.score).toFixed(1)}<span className="denom"> /10</span></span>
                </div>
                <div className="scout-grade">{s.grade}</div>
                <div className="scout-rationale">{s.rationale}</div>
                <div className="scout-chips">
                  {(s.filters || []).map((f, j) => (
                    <span className={`chip ${j === s.filters.length - 1 ? 'acc' : ''}`} key={f}>{f}</span>
                  ))}
                </div>
                <div className="scout-meta">
                  <span>{s.sector}</span>
                  <span>Path {s.valPath} · Open DD →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// =============================================================
// API HEALTH PANEL
// =============================================================
function ApiHealthPanel() {
  const health = window.API_HEALTH || [];
  const overall = useMemo(() => {
    const errs = health.filter(a => a.status === 'error').length;
    const degr = health.filter(a => a.status === 'degraded').length;
    if (errs) return { src: 'error', label: `${errs} DOWN` };
    if (degr) return { src: 'cached', label: `${degr} DEGRADED` };
    return { src: 'live', label: 'ALL OK' };
  }, []);

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">09</span> API Health</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>{health.length} SERVICES</span>
          <SrcPill src={overall.src} age={overall.label} />
        </div>
      </div>
      <div className="panel-body">
        <div className="api-health-list">
          {health.map(api => {
            const pct = api.quota ? Math.min(100, (api.used / api.quota) * 100) : 0;
            const quotaWarn = pct > 75;
            return (
              <div key={api.id} className={`api-card ${api.status}`}>
                <div className="api-card-top">
                  <span className="api-card-name">{api.name}</span>
                  <span className={`api-card-status ${api.status}`}>
                    {api.status === 'ok' ? '● OK' : api.status === 'degraded' ? '◐ DEGR' : '✕ DOWN'}
                  </span>
                </div>
                <div className="api-card-scope">{api.scope}</div>
                <div className="api-card-metrics">
                  {api.latency > 0 && <span><span className="lbl">p95</span>{api.latency}ms</span>}
                  <span><span className="lbl">ok</span>{api.lastOk}</span>
                </div>
                {api.quota > 0 && (
                  <>
                    <div className="api-card-metrics">
                      <span><span className="lbl">use</span>{api.used.toLocaleString()} / {api.quota.toLocaleString()}</span>
                      <span>{pct.toFixed(0)}%</span>
                    </div>
                    <div className={`api-quota-bar ${quotaWarn ? 'warn' : ''}`}>
                      <i style={{ width: pct + '%' }} />
                    </div>
                  </>
                )}
                {api.warning && <div className="warning">⚠ {api.warning}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// =============================================================
// SCOUT DD MODAL
// =============================================================
function ScoutDDModal({ ticker, onClose }) {
  if (!ticker) return null;
  const dd = window.ddForTicker?.(ticker);
  if (!dd) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="research" size={16} />
          <div className="modal-title">Sovereign DD — {dd.ticker}</div>
          <div style={{ flex: 1 }} />
          {dd.fromScout && (
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--acc)', padding: '4px 8px', border: '1px solid var(--acc)' }}>
              From Scout
            </span>
          )}
          <SrcPill src="cached" age={dd.asOf} />
          <button className="btn-icon" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="dd-result-header">
            <div>
              <div className="dd-ticker">{dd.ticker}</div>
              <div className="dd-conf">CONF: {dd.confidence}</div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: 'right' }}>
              <div className="dd-score">{(+dd.score).toFixed(1)}<span className="denom"> / 10</span></div>
              <div className={`dd-grade ${dd.grade.toLowerCase().replace(/\s+/g, '-')}`}>{dd.grade}</div>
            </div>
          </div>
          <div className="dd-section">
            <div className="dd-section-label">Thesis</div>
            <div className="dd-thesis">{dd.thesis}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <div className="dd-section-label">Key Swing Factor</div>
              <div className="dd-swing">{dd.swing}</div>
            </div>
            {dd.dissent && (
              <div>
                <div className="dd-section-label">Dissent</div>
                <div className="dd-dissent">{dd.dissent}</div>
              </div>
            )}
          </div>
          {dd.agents?.length > 0 && (
            <div className="dd-section">
              <div className="dd-section-label">Agent Votes</div>
              <div className="dd-agents">
                {dd.agents.map(a => (
                  <div key={a.name} className="dd-agent">
                    <div className="ag-name">{a.name}</div>
                    <div className={`ag-vote ${(a.vote || '').toLowerCase()}`}>{a.vote}</div>
                    <div className="ag-rationale">{a.rationale}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="mono dim" style={{ fontSize: 11 }}>Re-run analysis to refresh with latest agent debate</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  HoldingsPanel, HeatmapPanel, IntelPanel, NewsPanel, MacroPanel,
  FilingsPanel, DDPanel, ScoutPanel, ApiHealthPanel, ScoutDDModal,
});
