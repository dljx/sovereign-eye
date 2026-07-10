/* global React, window, Icon, SrcPill, GaugeBar, Sparkline, AgentPixel, MacroChart, Treemap,
   fmtUSD, fmtUSDC, fmtMoney, fmtPct, sign, normQ, _relDate,
   POSITIONS, QUOTES, SYNTHESIS, SEC_FILINGS,
   DD_RESULT, SCOUTS, MACRO_SERIES, SPARKS, computeTotals, API_HEALTH,
   _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry, RRChip */
(function () {
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// Hold-mode labels + shared card/news helpers live in dd-shared.jsx (window
// exports) so desktop and mobile can't drift apart.
const { holdLabel, gradeForResult, DDResultFull, normalizeScoutCard, FireBody, FireChart, fmtSgdCompact } = window;

// =============================================================
// HOLDINGS PANEL
// =============================================================
function HoldingsPanel({ positions, quotes, totals, sortKey, sortDir, onSort, onHover, onLeave, hoveredTk, onRowClick }) {
  // Re-render when real sparklines arrive from /api/sparks
  const [_sv, setSv] = useState(0);
  useEffect(() => {
    const h = () => setSv(v => v + 1);
    window.addEventListener('se:sparks', h);
    return () => window.removeEventListener('se:sparks', h);
  }, []);

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

  if (!sorted.length) {
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--fg-2)', fontSize: 12 }}>
        <div style={{ marginBottom: 10 }}>No positions yet.</div>
        <div style={{ fontSize: 11, opacity: 0.8 }}>
          Use <b>Import</b> (top right) to load your portfolio from a broker screenshot.
        </div>
      </div>
    );
  }

  return (
    <table className="holdings-table">
      <thead>
        <tr>
          <Sort k="ticker" align="left">Ticker</Sort>
          <th style={{ textAlign: 'left' }}>Broker</th>
          <Sort k="qty">Qty</Sort>
          <Sort k="avg">Avg</Sort>
          <Sort k="px">Last</Sort>
          <Sort k="dPct" title="Today's price change — not your total return">Today%</Sort>
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
              onClick={() => onRowClick && p.ticker !== 'USD' && onRowClick(p.ticker)}
              style={{ cursor: p.ticker === 'USD' ? 'default' : 'pointer', ...(hoveredTk === p.ticker ? { background: 'var(--bg-2)' } : null) }}>
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
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 300 }}>
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
    let interval = null;
    const start = () => {
      const tickers = [...new Set((window.POSITIONS || []).map(p => p.ticker).filter(Boolean))];
      if (!tickers.length) return;
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
      interval = setInterval(load, 5 * 60 * 1000);
    };
    start();
    window.addEventListener('se:positions', start, { once: true });
    return () => {
      window.removeEventListener('se:positions', start);
      if (interval) clearInterval(interval);
    };
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
// Time/decay/filter logic shared with mobile — see dd-shared.jsx NewsUtils.
const { parseAgoMs, decayImp, applyNewsFilters } = window.NewsUtils;

const _mapPortfolioItem = d => ({ tk: d.tk||d.ticker, headline: d.headline, src: d.src||d.source, t: d.t||d.ago, macro: false, url: d.url||'', importance: d.importance??50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment??'neutral', _scoring: !!d._scoring });
const _mapWireItem      = d => ({ tk: d.tk||d.ticker_or_sector, headline: d.headline, src: d.src||d.source, t: d.t||d.ago, macro: d.macro!==false && d.tag!=='TICKER', url: d.url||'', importance: d.importance??50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment??'neutral', _scoring: !!d._scoring });

function NewsPanel() {
  const [tab, setTab]               = useState('portfolio');
  const [livePortfolio, setLivePortfolio] = useState(null);
  const [liveWire, setLiveWire]     = useState(null);
  const [src, setSrc]               = useState('loading');
  const [period, setPeriod]         = useState('1W');
  const [sortMode, setSortMode]     = useState('rank');
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [tickerFilter, setTickerFilter] = useState(null);

  useEffect(() => {
    let interval = null;
    let rescore = null;

    const restoreLS = (key, mapper, setter) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const { items, savedAt } = JSON.parse(raw);
        if (!Array.isArray(items) || Date.now() - savedAt > 3600000) return false;
        setter(items.map(mapper));
        return true;
      } catch { return false; }
    };

    const start = () => {
      const tickers = [...new Set((window.POSITIONS || []).map(p => p.ticker).filter(Boolean))];
      if (!tickers.length) return;
      const qs = tickers.join(',');

      // Restore from localStorage immediately
      const hadP = restoreLS(`se:news:v4:${qs}`, _mapPortfolioItem, setLivePortfolio);
      const hadW = restoreLS(`se:wire:v4:${qs}`, _mapWireItem, setLiveWire);
      if (hadP || hadW) setSrc('cached');

      // The news API scores tickers progressively (a few per request) and returns
      // Single Gemma call scores the whole portfolio in background (~15-20s).
      // Re-poll once after 60s to pick up fresh scores; cache stays warm after that.
      let scoreAttempts = 0;
      const load = (isRescore) => {
        if (!isRescore) scoreAttempts = 0;
        const newsP = fetch(`/api/news?tickers=${qs}&v=16`)
          .then(async r => r.ok ? { items: await r.json().catch(() => null), status: r.headers.get('X-News-Status') } : { items: null, status: null })
          .catch(() => ({ items: null, status: null }));
        const wireP = fetch(`/api/wire?tickers=${qs}&v=9`)
          .then(async r => r.ok ? { items: await r.json().catch(() => null), status: r.headers.get('X-News-Status') } : { items: null, status: null })
          .catch(() => ({ items: null, status: null }));
        Promise.all([newsP, wireP]).then(([newsRes, wireRes]) => {
          const news = newsRes.items;
          const wire = wireRes.items;
          if (Array.isArray(news) && news.length) {
            const mapped = news.map(d => ({ tk: d.ticker, headline: d.headline, src: d.source, t: d.ago, macro: false, url: d.url||'', importance: d.importance??50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment??'neutral', _scoring: !!d._scoring }));
            setLivePortfolio(mapped);
            try { localStorage.setItem(`se:news:v4:${qs}`, JSON.stringify({ items: mapped, savedAt: Date.now() })); } catch {}
          }
          // Don't blank the panel if scoring returned empty — keep showing cached/seed data
          if (Array.isArray(wire) && wire.length) {
            const mapped = wire.map(d => ({ tk: d.ticker_or_sector, headline: d.headline, src: d.source, t: d.ago, macro: d.tag !== 'TICKER', url: d.url||'', importance: d.importance??50, why: d.why||'', datetime: d.datetime??0, sentiment: d.sentiment??'neutral', _scoring: !!d._scoring }));
            setLiveWire(mapped);
            try { localStorage.setItem(`se:wire:v4:${qs}`, JSON.stringify({ items: mapped, savedAt: Date.now() })); } catch {}
          } else if (Array.isArray(wire) && wireRes.status !== 'scoring') {
            // Genuinely empty — but never blank the tab mid-rescore (wire now
            // serves stale + refreshes in the background, like news).
            setLiveWire([]);
          }
          // Pill honesty: LINK only when at least one feed actually answered;
          // 'scoring' means we're showing stale-being-refreshed (CACHE); both
          // feeds failing is a FAULT — never label a dead fetch as live.
          const anyOk   = newsRes.items !== null || wireRes.items !== null;
          const scoring = newsRes.status === 'scoring' || wireRes.status === 'scoring';
          setSrc(!anyOk ? 'error' : scoring ? 'cached' : 'live');
          // Re-poll once after 60s if scoring is still in progress (background job takes ~15-20s)
          if (scoring && scoreAttempts < 2) {
            scoreAttempts++;
            if (rescore) clearTimeout(rescore);
            rescore = setTimeout(() => load(true), 60000);
          }
        }).catch(() => setSrc('error'));
      };

      if (interval) clearInterval(interval);
      load(false);
      interval = setInterval(() => load(false), 15 * 60 * 1000);
    };

    // Try immediately (positions may already be in window.POSITIONS)
    start();
    // Re-run when positions load from KV (fires after /api/positions resolves)
    window.addEventListener('se:positions', start, { once: true });
    return () => { window.removeEventListener('se:positions', start); if (interval) clearInterval(interval); if (rescore) clearTimeout(rescore); };
  }, []);

  const portfolioList  = livePortfolio;
  const wireList       = liveWire;
  const rawList        = tab === 'portfolio' ? portfolioList : wireList;
  const periodSorted   = rawList ? applyNewsFilters(rawList, period, sortMode) : null;
  const list           = (periodSorted && tickerFilter) ? periodSorted.filter(n => n.tk === tickerFilter) : periodSorted;

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">04</span> News</div>
        <div className="tabs">
          <span className={`tab ${tab === 'portfolio' ? 'active' : ''}`} onClick={() => { setTab('portfolio'); setExpandedIdx(null); }}>
            Portfolio {portfolioList && <span className="count">{portfolioList.length}</span>}
          </span>
          <span className={`tab ${tab === 'wire' ? 'active' : ''}`} onClick={() => { setTab('wire'); setExpandedIdx(null); }}>
            Wire {wireList && <span className="count">{wireList.length}</span>}
          </span>
        </div>
        <div className="panel-actions">
          <div className="news-controls">
            {['1D','1W','1M'].map(p => (
              <span key={p} className={`news-filter-btn ${period === p ? 'active' : ''}`}
                    onClick={() => { setPeriod(p); setExpandedIdx(null); }}>{p}</span>
            ))}
            {tickerFilter && (
              <span className="news-ticker-chip">
                {tickerFilter}
                <span className="news-ticker-chip-x" onClick={() => { setTickerFilter(null); setExpandedIdx(null); }}>×</span>
              </span>
            )}
            <span className="news-sort-btn" onClick={() => { setSortMode(s => s === 'rank' ? 'time' : 'rank'); setExpandedIdx(null); }}>
              {sortMode === 'rank' ? '↕ Rank' : '↕ Time'}
            </span>
          </div>
          <SrcPill src={src === 'loading' ? 'seed' : src} age={src === 'live' ? 'now' : src} />
        </div>
      </div>
      <div className="panel-body">
        {!list ? (
          <div className="news-loading">
            <div className="news-spinner" />
            <span>Loading news…</span>
          </div>
        ) : list.length === 0 ? (
          <div className="news-loading"><span>No items in this period</span></div>
        ) : (
          <div className="news-list">
            {list.map((n, i) => {
              const disp = n._scoring ? null : decayImp(n.importance, n._ts);
              const tier = n._scoring ? 'low' : disp >= 80 ? 'top' : disp >= 60 ? 'mid' : 'low';
              const isTop = i === 0 && sortMode === 'rank';
              const isOpen = expandedIdx === i;
              const exactDate = n._ts ? new Date(n._ts * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
              return (
                <React.Fragment key={i}>
                  <div
                    className={`news-item news-tier-${tier}${isTop ? ' news-ranked1' : ''}${isOpen ? ' news-item-open' : ''}`}
                    onClick={() => setExpandedIdx(isOpen ? null : i)}
                  >
                    <div className="news-importance-bar" />
                    {n._scoring
                      ? <div className="news-score news-score-scoring" title="AI scoring in progress">···</div>
                      : <div className="news-score">{disp}</div>
                    }
                    <div
                      className={`news-tk${n.macro ? ' macro' : ''}${tickerFilter === n.tk ? ' news-tk-active' : ''}`}
                      onClick={e => { e.stopPropagation(); setTickerFilter(tickerFilter === n.tk ? null : n.tk); setExpandedIdx(null); }}
                    >{n.tk}</div>
                    <div className="news-body">
                      <div className="news-headline">
                        {n.url
                          ? <a href={n.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{n.headline}</a>
                          : n.headline}
                      </div>
                      {n.why && <div className="news-why">{n.why}</div>}
                      <div className="news-meta">
                        {n._scoring
                          ? <span className="news-sent news-sent-scoring">SCORING</span>
                          : n.sentiment && <span className={`news-sent news-sent-${n.sentiment}`}>{n.sentiment === 'bull' ? '▲ BULL' : n.sentiment === 'bear' ? '▼ BEAR' : '— NEU'}</span>
                        }
                        {n.src}
                      </div>
                    </div>
                    <div className="news-time">{n.t}</div>
                  </div>
                  {isOpen && (
                    <div className="news-expand-row">
                      {exactDate && <span className="news-expand-date">{exactDate}</span>}
                      {n.url && <a className="news-expand-link" href={n.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Read Article →</a>}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
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
  const [liveMs, setLiveMs] = useState(null);
  const [src, setSrc] = useState('seed');

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch('/api/nav-history')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.nav?.length && d?.spx?.length) {
          setLiveMs(d);
          setSrc('live');
        }
      })
      .catch(() => {});
  }, []);

  const ms = liveMs || window.MACRO_SERIES || { nav: [], spx: [] };
  const lastNav = ms.nav[ms.nav.length - 1] || 100;
  const lastSpx = ms.spx[ms.spx.length - 1] || 100;
  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">05</span> Macro Correlation</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>14M · MONTHLY</span>
          <SrcPill src={src} age={src === 'live' ? 'now' : 'seed'} />
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
    const start = () => {
      const tickers = [...new Set((window.POSITIONS || []).map(p => p.ticker).filter(Boolean))];
      if (!tickers.length) { setSrc('seed'); return; }
      const qs = tickers.join(',');
      fetch(`/api/filings?tickers=${qs}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (Array.isArray(data) && data.length) {
            // Overlay seed TLDRs where available
            const seedMap = {};
            (window.SEC_FILINGS || []).forEach(f => {
              if (!seedMap[f.tk]) seedMap[f.tk] = { tldr: f.tldr, sent: f.sent };
            });
            setRows(data.map(f => ({
              ...f,
              tldr: f.tldr || seedMap[f.tk]?.tldr || '—',
              sent: f.sent !== 'neutral' ? f.sent : (seedMap[f.tk]?.sent || 'neutral'),
            })));
            setSrc('live');
          } else {
            setSrc('seed');
          }
        })
        .catch(() => setSrc('seed'));
    };
    start();
    window.addEventListener('se:positions', start, { once: true });
    return () => window.removeEventListener('se:positions', start);
  }, []);

  const display = rows || (window.SEC_FILINGS || []);

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">06</span> SEC Tracker</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>{display.length} RECENT</span>
          <SrcPill src={src === 'loading' ? 'cached' : src} age={src === 'loading' ? '…' : src === 'live' ? 'now' : undefined} />
        </div>
      </div>
      <div className="panel-body">
        <div className="filings-list">
          {display.map((f, i) => (
            <div className="filing-item" key={i}>
              {f.url
                ? <a className="filing-form" href={f.url} target="_blank" rel="noopener noreferrer">{f.form}</a>
                : <span className="filing-form">{f.form}</span>
              }
              <span className="filing-tk">{f.tk}</span>
              <div>
                <div className="filing-tldr">{f.tldr || '—'}</div>
                <div className="news-meta">{f.filedDate ? f.filedDate.slice(0, 10) : f.when}</div>
              </div>
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
// _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry
// now live in dd-shared.jsx (loaded before this script).

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

function DDTrendChart({ rows, currentPrice }) {
  if (!rows?.length) return null;
  const pts = [...rows].reverse(); // oldest→newest
  const fvs   = pts.map(r => r.result_fv).filter(v => v != null);
  const cfvs  = pts.map(r => r.composite_fv).filter(v => v != null);
  const allY  = [...fvs, ...cfvs, currentPrice].filter(Boolean);
  if (!allY.length) return null;

  const W = 280, H = 56, PAD = 4;
  const minY = Math.min(...allY) * 0.95;
  const maxY = Math.max(...allY) * 1.05;
  const scaleX = i => PAD + (i / Math.max(pts.length - 1, 1)) * (W - PAD * 2);
  const scaleY = v => PAD + (1 - (v - minY) / (maxY - minY)) * (H - PAD * 2);

  const line = (arr, key) => {
    const valid = arr.map((r, i) => r[key] != null ? `${scaleX(i)},${scaleY(r[key])}` : null).filter(Boolean);
    return valid.length > 1 ? `M${valid.join('L')}` : null;
  };

  const gradeColor = g => {
    const gl = (g || '').toLowerCase();
    if (gl.includes('buy') || gl === 'add') return '#a78bfa';
    if (gl.includes('sell') || gl === 'exit' || gl === 'trim') return '#f87171';
    return '#6b7280';
  };

  return (
    <div className="dd-trend">
      <div className="dd-section-label" style={{ marginBottom: 6 }}>Fair Value History</div>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        {currentPrice && (
          <line x1={PAD} y1={scaleY(currentPrice)} x2={W - PAD} y2={scaleY(currentPrice)}
            stroke="var(--fg-4)" strokeWidth={1} strokeDasharray="3 2" />
        )}
        {line(pts, 'composite_fv') && (
          <path d={line(pts, 'composite_fv')} fill="none" stroke="var(--fg-4)" strokeWidth={1.5} strokeDasharray="4 2" />
        )}
        {line(pts, 'result_fv') && (
          <path d={line(pts, 'result_fv')} fill="none" stroke="var(--acc)" strokeWidth={1.5} />
        )}
        {pts.map((r, i) => r.result_fv != null && (
          <circle key={i} cx={scaleX(i)} cy={scaleY(r.result_fv)} r={3}
            fill={gradeColor(r.grade)} stroke="var(--bg-1)" strokeWidth={1} />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--fg-4)', fontFamily: 'var(--mono)' }}>
        <span>{pts[0] ? new Date(pts[0].run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        <span style={{ color: 'var(--fg-3)' }}>{pts.length} run{pts.length !== 1 ? 's' : ''}</span>
        <span>{pts[pts.length - 1] ? new Date(pts[pts.length - 1].run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 9, color: 'var(--fg-4)', fontFamily: 'var(--mono)' }}>
        <span><span style={{ color: 'var(--acc)' }}>—</span> LLM FV</span>
        <span><span style={{ color: 'var(--fg-4)' }}>- -</span> Archetype FV</span>
        {currentPrice && <span><span style={{ color: 'var(--fg-4)' }}>···</span> Price ${currentPrice.toFixed(0)}</span>}
      </div>
    </div>
  );
}

function DDPanel({ onTickerSelect }) {
  const [state, setState] = useState('idle'); // idle | loading | result
  const [input, setInput] = useState('');
  const [ticker, setTicker] = useState(null);
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState(null);
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
    if (pollRef.current)    { clearTimeout(pollRef.current);     pollRef.current = null; }
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

    let pollFailCount = 0;
    let pollDelay = 15_000;
    const scheduleNextPoll = () => {
      pollRef.current = setTimeout(doPoll, pollDelay);
    };
    const doPoll = async () => {
      try {
        // Uppercase URL — the canonical form all clients share, so the edge
        // cache has ONE entry per ticker and upload purges actually hit it.
        const r = await fetch(`/api/dd/${tk.toUpperCase()}`);
        if (r.ok) {
          pollFailCount = 0;
          pollDelay = 15_000;
          const data = await r.json();
          const d = data?.result || data;
          if (data && (d.consensus_score != null || d.score != null)) {
            stopAll();
            const mapped = _mapDDResult(data);
            // Keep the raw result too — the rich shared renderer (DDResultFull)
            // shows fair value/moat/banger/cycle/transcript that the reduced
            // mapped shape drops.
            if (mapped) { setResult({ ...mapped, _raw: d }); setState('result'); return; }
          }
        } else {
          pollFailCount++;
          pollDelay = Math.min(15_000 * Math.pow(2, pollFailCount), 5 * 60_000);
        }
      } catch {
        pollFailCount++;
        pollDelay = Math.min(15_000 * Math.pow(2, pollFailCount), 5 * 60_000);
      }
      scheduleNextPoll();
    };

    setTimeout(() => {
      doPoll();
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

  // Start idle — no auto-loaded default ticker. The user picks a ticker (or clicks
  // a scout result) to run/load a DD; previously this auto-loaded AVGO on mount.

  // Fetch Supabase trend history whenever a ticker is actually selected
  useEffect(() => {
    if (!ticker) { setTrendData(null); return; }
    fetch(`/api/dd/trend?ticker=${ticker}&limit=30`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d) && d.length) setTrendData(d); })
      .catch(() => {});
  }, [ticker]);

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
            {displayResult._raw ? (
              // Full shared renderer (fair value/moat/banger/cycle/transcript) —
              // the manual-analyze view used to show a reduced hand-rolled shape
              // while clicking a holding showed everything.
              <DDResultFull data={displayResult._raw} />
            ) : (
              // Seed/legacy reduced shape (window.DD_RESULT) — no raw payload.
              <>
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
              </>
            )}
            {trendData?.length > 1 && (
              <div className="dd-section">
                <DDTrendChart rows={trendData} currentPrice={trendData[0]?.price} />
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
  const [mode, setMode] = useState('scouts'); // scouts | gems

  useEffect(() => {
    setCards(null);
    setSrc('loading');
    fetch(mode === 'gems' ? '/api/dd/gems' : mode === 'review' ? '/api/dd/watchlist' : '/api/dd/scouts')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length) {
          // Normalize sovereign-dd scout shape → design shape (shared with
          // mobile via dd-shared.jsx so the two can't drift).
          setCards(d.map(normalizeScoutCard));
          setSrc('live');
        } else {
          setSrc('seed');
        }
      })
      .catch(() => setSrc('seed'));
  }, [mode]);

  const display = cards || (mode === 'scouts' ? (window.SCOUTS || []) : []);
  const age = src === 'live' ? 'now' : src === 'loading' ? '…' : 'seed';

  const nextRun = (() => {
    // scout.yml cron is "0 */4 * * *" — every 4h UTC. (This used to claim
    // 06:00 ET, which is the PORTFOLIO analyze.yml schedule, not scout's —
    // off by up to ~20h.)
    const next = new Date();
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 4 - (next.getUTCHours() % 4));
    const mins = Math.max(1, Math.round((next - Date.now()) / 60000));
    const hhmm = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `≈ ${hhmm} (in ${mins >= 60 ? Math.round(mins / 60) + 'h' : mins + 'm'})`;
  })();

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">08</span> Sovereign {mode === 'gems' ? 'Gems' : mode === 'review' ? 'Review' : 'Scout'}</div>
        <div className="tabs">
          {[['scouts', 'Scout'], ['gems', 'Gems'], ['review', 'Under Review']].map(([m, label]) => (
            <span key={m} className={`tab ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>{label}</span>
          ))}
        </div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
            {display.length} {mode === 'review' ? 'UNDER REVIEW' : 'BUY SIGNALS'}
          </span>
          <SrcPill src={src === 'loading' ? 'cached' : src} age={age} />
        </div>
      </div>
      <div className="panel-body">
        {src === 'loading' || (src === 'seed' && display.length === 0) ? (
          mode === 'review' ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
              <div className="mono uppercase" style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 8 }}>Nothing under review</div>
              <div style={{ fontSize: 12 }}>BUYs that fail the confirmation gate land here</div>
              <div style={{ marginTop: 6, fontSize: 11 }}>quality checks → red-team falsification</div>
            </div>
          ) : (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-3)' }}>
              <div className="mono uppercase" style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 8 }}>{mode === 'gems' ? 'Gems' : 'Scout'} is hunting</div>
              <div style={{ fontSize: 12 }}>Screened every 4h · next run {nextRun}</div>
              <div style={{ marginTop: 6, fontSize: 11 }}>screener → Gemini triage → 5-agent debate</div>
            </div>
          )
        ) : (
          <div className="scout-grid">
            {display.map((s, i) => {
              // v3 (2026-07-07): a red-team DOWNGRADE surfaces here flagged rather
              // than being suppressed to Under Review like a VETO.
              const flagged = mode !== 'review' && s.verdict === 'DOWNGRADE';
              return (
              <div
                key={s.tk + '-' + i}
                className={`scout-card ${mode === 'review' ? 'hold review' : s.grade.toLowerCase().replace(' ','-')}${i === 0 ? ' featured' : ''}${flagged ? ' flagged' : ''}`}
                onClick={() => onPick && onPick(s)}
                title={`Open DD for ${s.tk}`}
              >
                <div className="scout-card-top">
                  <span className="scout-tk">{s.tk}</span>
                  <span className="scout-score">{(+s.score).toFixed(1)}<span className="denom"> /10</span></span>
                </div>
                <div className="scout-grade">{mode === 'review' && s.verdict ? `⚠ ${s.verdict}` : flagged ? `⚠ ${s.grade}` : s.grade}</div>
                <div className="scout-rationale">{(mode === 'review' || flagged) && s.reviewReason ? s.reviewReason : s.rationale}</div>
                <div className="scout-chips">
                  {flagged && s.vscore != null && <span className="chip warn" title="Red-team DOWNGRADE — real concerns, not fatal. Score is the prosecutor's conviction /10.">⚠ {(+s.vscore).toFixed(1)}</span>}
                  {!flagged && mode !== 'review' && s.vscore != null && <span className="chip ok" title="Red-team CONFIRM — the bull thesis survived adversarial scrutiny. Score /10.">🛡 {(+s.vscore).toFixed(1)}</span>}
                  {mode === 'review' && s.vscore != null && <span className="chip warn" title="Verification score from the red-team review /10">verify {(+s.vscore).toFixed(1)}</span>}
                  {mode !== 'review' && s.verdict === 'UNVERIFIED' && <span className="chip dim" title="Confirmation gate never reached a verdict on this one — treat as unaudited">unverified</span>}
                  {s.rr != null && <span className="chip rr" title="Computed reward-to-risk: upside vs conservative downside floor">R/R {(+s.rr).toFixed(1)}</span>}
                  {(s.filters || []).map((f, j) => (
                    <span className={`chip ${j === s.filters.length - 1 ? 'acc' : ''}`} key={f + '-' + j}>{f}</span>
                  ))}
                </div>
                <div className="scout-meta">
                  <span>{s.sector}</span>
                  <span>
                    {s.ageDays != null && <span className={`card-age${s.ageDays > 7 ? ' stale' : ''}`} title={`Analyzed ${s.analyzedAt}`}>{s.ageDays === 0 ? 'today' : `${s.ageDays}d`} · </span>}
                    Path {s.valPath} · Open DD →
                  </span>
                </div>
              </div>
              );
            })}
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
  const [health, setHealth] = useState(null);
  const [src, setSrc] = useState('seed');

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length) {
          setHealth(data);
          setSrc('live');
        }
      })
      .catch(() => {});
  }, []);

  const display = health || window.API_HEALTH || [];

  const overall = useMemo(() => {
    const errs = display.filter(a => a.status === 'error' || a.status === 'down').length;
    const degr = display.filter(a => a.status === 'degraded' || a.status === 'unknown').length;
    if (errs) return { label: `${errs} DOWN` };
    if (degr) return { label: `${degr} DEGRADED` };
    return { label: 'ALL OK' };
  }, [display]);

  const overallSrc = src === 'live'
    ? (display.some(a => a.status === 'error' || a.status === 'down') ? 'error'
      : display.some(a => a.status === 'degraded' || a.status === 'unknown') ? 'cached'
      : 'live')
    : 'seed';

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">09</span> API Health</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>{display.length} SERVICES</span>
          <SrcPill src={overallSrc} age={overall.label} />
        </div>
      </div>
      <div className="panel-body">
        <div className="api-health-list">
          {display.map(api => {
            const pct = (api.quota && api.used != null) ? Math.min(100, (api.used / api.quota) * 100) : 0;
            const quotaWarn = pct > 75;
            const statusLabel = api.status === 'ok' ? '● OK'
              : api.status === 'degraded' ? '◐ DEGR'
              : api.status === 'unknown'  ? '○ N/A'
              : '✕ DOWN';
            return (
              <div key={api.id} className={`api-card ${api.status}`}>
                <div className="api-card-top">
                  <span className="api-card-name">{api.name}</span>
                  <span className={`api-card-status ${api.status}`}>{statusLabel}</span>
                </div>
                <div className="api-card-scope">{api.scope}</div>
                <div className="api-card-metrics">
                  {api.latency > 0 && <span><span className="lbl">p95</span>{api.latency}ms</span>}
                  <span><span className="lbl">ok</span>{api.lastOk}</span>
                </div>
                {api.quota > 0 && api.used != null && (
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
function ScoutDDModal({ scout, onClose }) {
  if (!scout) return null;
  // `scout` is the normalized card from ScoutPanel — it already carries the agent
  // debate consensus pulled from /api/dd/scouts (thesis, swing, catalyst, position,
  // banger, cycle), so we render directly with no extra fetch.
  const gradeLabel = (scout.grade || 'HOLD').replace(/-/g, ' ');
  const gradeClass = gradeLabel.toLowerCase().replace(/\s+/g, '-');
  const pos    = scout.position && typeof scout.position === 'object' ? scout.position : null;
  const banger = scout.banger && typeof scout.banger === 'object' && scout.banger.is_banger ? scout.banger : null;
  const cycle  = scout.cycle && typeof scout.cycle === 'object' && scout.cycle.phase ? scout.cycle : null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="research" size={16} />
          <div className="modal-title">Sovereign DD — {scout.tk}</div>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--acc)', padding: '4px 8px', border: '1px solid var(--acc)' }}>
            From Scout
          </span>
          <SrcPill src="cached" age={scout.analyzedAt ? _relDate(scout.analyzedAt) : 'scouted'} />
          <button className="btn-icon" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="dd-result-header">
            <div>
              <div className="dd-ticker">{scout.tk}</div>
              {scout.conf && <div className="dd-conf">CONF: {scout.conf}</div>}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: 'right' }}>
              <div className="dd-score">{(+scout.score).toFixed(1)}<span className="denom"> / 10</span></div>
              <div className={`dd-grade ${gradeClass}`}>{gradeLabel}</div>
            </div>
          </div>

          {scout.verdict === 'DOWNGRADE' && (
            <div className="dd-section" style={{ color: 'var(--warn)' }}>
              <div className="dd-section-label">
                ⚠ Red-Team Flagged — DOWNGRADE{scout.vscore != null ? ` · ${(+scout.vscore).toFixed(1)}/10` : ''}
              </div>
              <div className="dd-thesis">
                {scout.reviewReason || 'Red-team review raised concerns that weren’t fatal to the thesis — weigh this against the bull case below.'}
              </div>
            </div>
          )}

          {banger && (
            <div className="dd-section" style={{ color: 'var(--acc)' }}>
              <div className="dd-section-label">🔥 Banger</div>
              <div className="dd-thesis">{banger.reason || 'Flagged as a high-conviction asymmetric setup.'}</div>
            </div>
          )}

          <div className="dd-section">
            <div className="dd-section-label">Thesis</div>
            <div className="dd-thesis">{scout.thesis || scout.rationale || 'No thesis recorded for this scout pick.'}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {scout.keySwing && (
              <div>
                <div className="dd-section-label">Key Swing Factor</div>
                <div className="dd-swing">{scout.keySwing}</div>
              </div>
            )}
            {scout.catalyst && (
              <div>
                <div className="dd-section-label">Catalyst</div>
                <div className="dd-dissent">{scout.catalyst}</div>
              </div>
            )}
          </div>

          {(scout.asymmetry || pos || cycle || scout.rr != null) && (
            <div className="dd-section">
              <div className="dd-section-label">Setup</div>
              <div className="dd-thesis" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
                {scout.rr != null && <span title="Computed reward-to-risk: blended fair-value/analyst upside vs a conservative downside floor"><b>R/R:</b> {(+scout.rr).toFixed(1)}:1{scout.risk ? ` (${scout.risk} risk)` : ''}</span>}
                {scout.asymmetry && <span title="The agents' stated upside:downside asymmetry"><b>Asymmetry:</b> {scout.asymmetry}</span>}
                {pos && pos.range && <span><b>Position:</b> {pos.range}{_sizingHint(pos.range)}{pos.reasoning ? ` — ${pos.reasoning}` : ''}</span>}
                {cycle && <span><b>Cycle:</b> {cycle.regime ? `${cycle.regime} — ` : ''}{cycle.phase}</span>}
              </div>
            </div>
          )}

          {Array.isArray(scout.filters) && scout.filters.length > 0 && (
            <div className="dd-section">
              <div className="dd-section-label">Matched Filters{scout.valPath && scout.valPath !== '—' ? ` · Path ${scout.valPath}` : ''}</div>
              <div className="scout-chips">
                {scout.filters.map((f, j) => <span className="chip" key={f + '-' + j}>{f}</span>)}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="mono dim" style={{ fontSize: 11 }}>Consensus from the scout debate · run a full DD to refresh</span>
          <span style={{ flex: 1 }} />
          <ReverifyButton ticker={scout.tk} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// "≈ S$X–Y at current NLV" suffix for a position_guidance range like "2-4%".
// Display-only arithmetic on the guidance the agents already produced.
function _sizingHint(range) {
  const nlv = window.__NLV || 0;
  const m = String(range || '').match(/([\d.]+)\s*[-–]\s*([\d.]+)\s*%/);
  if (!nlv || !m) return '';
  const lo = fmtUSDC(nlv * parseFloat(m[1]) / 100);
  const hi = fmtUSDC(nlv * parseFloat(m[2]) / 100);
  return ` (≈ ${lo}–${hi} of your portfolio)`;
}

// Re-runs the full DD via the existing trigger endpoint — the on-demand
// complement to the pipeline's calm-window re-verification. Fresh results
// land on the board/card after the run uploads (~4-6 min).
function ReverifyButton({ ticker }) {
  const [state, setState] = useState('idle'); // idle | busy | sent | err
  const fire = async () => {
    setState('busy');
    try {
      const r = await fetch('/api/dd/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      setState(r.ok ? 'sent' : 'err');
    } catch { setState('err'); }
  };
  if (state === 'sent') return <span className="mono pos" style={{ fontSize: 10 }}>DD queued — refreshes in ~5m</span>;
  return (
    <button className="btn" onClick={fire} disabled={state === 'busy'}
      title="Dispatch a fresh full DD run (agents + verification) for this ticker">
      {state === 'busy' ? 'Dispatching…' : state === 'err' ? 'Failed — retry?' : 'Re-run DD'}
    </button>
  );
}

// ── Holding dossier popup — fetches the real daily-screen DD for a ticker ──
// (DDTranscriptEntry now lives in dd-shared.jsx)

function HoldingDDModal({ ticker, onClose }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | empty | error
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setState('loading'); setData(null); setShowTranscript(false);
    let cancelled = false;
    fetch(`/api/dd/${ticker}`)
      .then(r => r.status === 404 ? { __empty: true } : (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        if (cancelled) return;
        if (d.__empty) { setState('empty'); return; }
        const result = d.result || d;
        if (!result || !result.ticker) { setState('empty'); return; }
        setData(result); setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (!ticker) return null;
  const gradeClass = g => (g || '').toLowerCase().replace(/\s+/g, '-');
  const scoreColor = s => s >= 7 ? 'bull' : s <= 5 ? 'bear' : 'neutral';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="research" size={16} />
          <div className="modal-title">Sovereign DD — {ticker}</div>
          <div style={{ flex: 1 }} />
          <SrcPill src="cached" age="daily screen" />
          <button className="btn-icon" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          {state === 'loading' && <div className="news-loading"><div className="news-spinner" /><span>Loading dossier…</span></div>}
          {state === 'empty' && <div className="news-loading"><span>No dossier yet for {ticker}. Daily pre-market screens populate this.</span></div>}
          {state === 'error' && <div className="news-loading"><span>Could not load dossier — try again.</span></div>}
          {state === 'ready' && data && (
            <>
              <div className="dd-result-header">
                <div>
                  <div className="dd-ticker">{data.ticker}</div>
                  <div className="dd-conf">CONF: {data.confidence || '—'}</div>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: 'right' }}>
                  <div className="dd-score">{Number(data.consensus_score).toFixed(1)}<span className="denom"> / 10</span></div>
                  {(() => {
                    const lbl = gradeForResult(data);
                    return <div className={`dd-grade ${gradeClass(lbl)}`}>{lbl}</div>;
                  })()}
                </div>
              </div>

              <div className="dd-chips">
                {data.entry_assessment && <span className="dd-chip">Entry: {String(data.entry_assessment).replace(/_/g, ' ')}</span>}
                {data.fair_value_composite != null && <span className="dd-chip">Fair value: ${data.fair_value_composite}</span>}
                <RRChip rr={data.risk_reward} />
                {data.asymmetry_ratio && <span className="dd-chip">Asymmetry: {data.asymmetry_ratio}</span>}
                {data.moat_composite != null && <span className="dd-chip">Moat: {data.moat_composite}/10</span>}
                {data.position_guidance?.range && <span className="dd-chip">Size: {data.position_guidance.range}</span>}
                {data.cycle_position?.regime && <span className="dd-chip">{data.cycle_position.regime} · {data.cycle_position.phase}</span>}
                {data.banger?.is_banger && <span className="dd-chip dd-chip-hot">BANGER</span>}
              </div>

              <div className="dd-section">
                <div className="dd-section-label">Majority Thesis</div>
                <div className="dd-thesis">{data.majority_thesis}</div>
              </div>
              {data.catalyst && (
                <div className="dd-section">
                  <div className="dd-section-label">Catalyst</div>
                  <div className="dd-thesis">{data.catalyst}</div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                {data.key_swing_factor && <div><div className="dd-section-label">Key Swing Factor</div><div className="dd-swing">{data.key_swing_factor}</div></div>}
                {data.dissent && <div><div className="dd-section-label">Dissent</div><div className="dd-dissent">{data.dissent}</div></div>}
              </div>
              {data.score_rationale && (
                <div className="dd-section">
                  <div className="dd-section-label">Score Rationale</div>
                  <div className="dd-swing">{data.score_rationale}</div>
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
                  <div className="dd-section-label dd-transcript-toggle" onClick={() => setShowTranscript(s => !s)}>
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
          )}
        </div>
        <div className="modal-footer">
          <span className="mono dim" style={{ fontSize: 11 }}>Compiled by the daily 5-agent debate</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// =============================================================
// SCB·10 — SIGNAL SCOREBOARD (forward returns vs VWRA)
// Data: /api/dd/scoreboard — KV dd:scoreboard, refreshed daily by
// the analyze cron (signal_analysis.py --json). Seed fallback so
// the panel renders before the first upload.
// =============================================================
const _SB_SECTIONS = [
  ['gate', 'Confirmation gate'],
  ['grade', 'Grade'],
  ['source', 'Source'],
  // "Did methodology v2 beat v1 out-of-sample?" as a standing view — see
  // sovereign-dd docs/ADAPTATION_PROTOCOL.md for what each version means.
  ['factors_v', 'Methodology version'],
];

function _sbPct(x, dec = 1) {
  return (x >= 0 ? '+' : '') + (x * 100).toFixed(dec) + '%';
}

// Flatten the scoreboard snapshot to CSV (one row per window × bucket entry,
// plus per-window overall rows) — client-side download, no new endpoint.
function _exportScoreboardCsv(sb) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [["window_weeks", "section", "bucket", "n", "hit_rate", "mean_excess", "median_excess"]];
  for (const w of sb.windows || []) {
    if (w.overall) {
      rows.push([w.weeks, "overall", "ALL", w.overall.n, w.overall.hit, w.overall.mean, w.overall.median]);
    }
    for (const [section, entries] of Object.entries(w.buckets || {})) {
      for (const r of entries || []) {
        rows.push([w.weeks, section, r.k, r.n, r.hit, r.mean, r.median]);
      }
    }
  }
  const csv = rows.map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `scoreboard_${(sb.as_of || "latest").replace(/[^0-9a-z-]/gi, "")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ScoreboardPanel() {
  const [sb, setSb] = useState(window.SE_SEED?.scoreboard || null);
  const [src, setSrc] = useState('seed');
  const [wi, setWi] = useState(0);

  useEffect(() => {
    fetch('/api/dd/scoreboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && Array.isArray(d.windows)) { setSb(d); setSrc('live'); }
      })
      .catch(() => {});
  }, []);

  const windows = sb?.windows || [];
  const w = windows[Math.min(wi, Math.max(windows.length - 1, 0))];
  const o = w?.overall;

  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">SCB·10</span> Signal Scoreboard</div>
        <div className="tabs">
          {windows.map((win, i) => (
            <span key={win.weeks} className={`tab ${i === wi ? 'active' : ''}`} onClick={() => setWi(i)}>
              {win.weeks}W
            </span>
          ))}
        </div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
            VS {sb?.benchmark || 'VWRA.L'}
          </span>
          {sb && (
            <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
              title="Download the scoreboard snapshot (all windows + buckets) as CSV"
              onClick={() => _exportScoreboardCsv(sb)}>
              CSV
            </button>
          )}
          <SrcPill src={src} age={sb?.generated_at ? _relDate(sb.generated_at) : undefined} />
        </div>
      </div>
      <div className="panel-body">
        {!sb || !w ? (
          <div className="sb-empty">No scoreboard yet — first snapshot lands with the next analyze run.</div>
        ) : !o ? (
          <div className="sb-empty">
            {w.weeks}-week window: nothing measurable yet · {w.pending} signal{w.pending === 1 ? '' : 's'} pending
          </div>
        ) : (
          <>
            <div className="sb-hero">
              <div>
                <div className="sb-big">{(o.hit * 100).toFixed(0)}%</div>
                <div className="sb-big-label">Hit rate vs index</div>
              </div>
              <div>
                <div className={`sb-big ${o.mean >= 0 ? 'pos' : 'neg'}`}>{_sbPct(o.mean)}</div>
                <div className="sb-big-label">Mean excess</div>
              </div>
              <div>
                <div className={`sb-big ${o.median >= 0 ? 'pos' : 'neg'}`}>{_sbPct(o.median)}</div>
                <div className="sb-big-label">Median excess</div>
              </div>
            </div>

            <div className="sb-gauge-row">
              <span>Win rate</span>
              <GaugeBar value={o.hit} tone={o.hit >= 0.5 ? 'pos' : 'warn'} />
              <span>{o.n} measured</span>
            </div>

            <div className="sb-chips">
              <span className="chip acc">{w.measurable} measured</span>
              <span className="chip">{w.pending} pending</span>
              {w.no_data > 0 && <span className="chip warn">{w.no_data} no-data</span>}
              {o.n < 10 && <span className="chip warn">⚠ small sample</span>}
            </div>

            {_SB_SECTIONS.map(([key, label]) => {
              const rows = w.buckets?.[key];
              if (!rows || !rows.length) return null;
              return (
                <div className="sb-section" key={key}>
                  <div className="dd-section-label">{label}</div>
                  <table className="sb-table"><tbody>
                    {rows.map(r => (
                      <tr key={r.k}>
                        <td className="k">{r.k}</td>
                        <td className="n">n={r.n}{r.n < 10 ? ' ⚠' : ''}</td>
                        <td className="g"><GaugeBar value={r.hit} tone={r.hit >= 0.5 ? 'pos' : 'warn'} height={5} /></td>
                        <td className="v dim">{(r.hit * 100).toFixed(0)}%</td>
                        <td className={`v ${r.mean >= 0 ? 'pos' : 'neg'}`}>{_sbPct(r.mean)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              );
            })}

            {(w.top?.length || w.bottom?.length) ? (
              <div className="sb-section">
                <div className="dd-section-label">Best / worst vs index</div>
                <div className="sb-movers">
                  {(w.top || []).map(t => (
                    <span className="sb-mover up" key={'t' + t.ticker + t.excess}
                      style={{ cursor: 'pointer' }} title={`Open DD for ${t.ticker}`}
                      onClick={() => { window.location.hash = `#dd/${t.ticker}`; }}>
                      ▲ {t.ticker} {_sbPct(t.excess)}
                    </span>
                  ))}
                  {(w.bottom || []).map(t => (
                    <span className="sb-mover down" key={'b' + t.ticker + t.excess}
                      style={{ cursor: 'pointer' }} title={`Open DD for ${t.ticker}`}
                      onClick={() => { window.location.hash = `#dd/${t.ticker}`; }}>
                      ▼ {t.ticker} {_sbPct(t.excess)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="sb-note">
              excess = signal forward return − {sb.benchmark} over the matched window
              · {sb.n_signals} signals logged ({sb.n_scout} scout · {sb.n_gems} gems)
              {sb.note ? <><br />{sb.note}</> : null}
              {(sb.versions || []).map(ver => (
                <React.Fragment key={ver.v}><br />{ver.v}: {ver.desc}</React.Fragment>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// =============================================================
// FIRE PANEL — thin desktop wrapper; the whole body (fetching, math,
// chart, settings form) is shared with mobile via dd-shared.FireBody.
// =============================================================
function FirePanel() {
  const [sgdRate, setSgdRate] = useState(window.CCY_RATES?.SGD || 1.35);
  return (
    <>
      <div className="panel-header">
        <div className="panel-title"><span className="num">FIRE·11</span> Financial Independence</div>
        <div className="panel-actions">
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>SGD · USD/SGD {sgdRate.toFixed(3)}</span>
        </div>
      </div>
      <div className="panel-body">
        <FireBody onRate={setSgdRate} />
      </div>
    </>
  );
}

Object.assign(window, {
  HoldingsPanel, HeatmapPanel, IntelPanel, NewsPanel, MacroPanel,
  FilingsPanel, DDPanel, ScoutPanel, ScoreboardPanel, ApiHealthPanel, ScoutDDModal, HoldingDDModal,
  FirePanel,
});
})();
