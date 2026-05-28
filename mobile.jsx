/* global React, ReactDOM, window, Icon, SrcPill, Sparkline, AgentPixel, MacroChart,
   fmtUSD, fmtUSDC, fmtMoney, fmtPct, sign, normQ,
   POSITIONS, QUOTES, SYNTHESIS, NEWS_PORTFOLIO, NEWS_WIRE,
   SEC_FILINGS, DD_RESULT, SCOUTS, MACRO_SERIES, SPARKS, computeTotals */
(function () {
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// =============================================================
// LIVE DATA HOOK — fetches KV positions + Finnhub quotes
// =============================================================
function useLiveData() {
  const [positions, setPositions] = useState(() =>
    (window.SE_CONFIG?.MY_POSITIONS || []).map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 }))
  );
  const [quotes, setQuotes] = useState(() => window.QUOTES || {});
  const [dataV, setDataV] = useState(0); // bump to force re-renders

  // Load positions from KV
  useEffect(() => {
    fetch('/api/positions')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length) {
          const pos = data.map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 }));
          setPositions(pos);
          window.POSITIONS = pos;
          setDataV(v => v + 1);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch quotes
  useEffect(() => {
    const tickers = (window.POSITIONS || []).map(p => p.ticker).filter(t => t && t !== 'USD');
    if (!tickers.length) return;

    const load = async () => {
      try {
        const r = await fetch(`/api/quotes?tickers=${tickers.join(',')}`).catch(() => null);
        if (r?.ok) {
          const data = await r.json();
          const next = { ...(window.QUOTES || {}) };
          Object.entries(data).forEach(([tk, q]) => {
            if (q) {
              const prev = next[tk] || {};
              next[tk] = { ...normQ(q), pe: q.pe ?? prev.pe, eps: q.eps ?? prev.eps, tgt: q.target ?? prev.tgt };
            }
          });
          window.QUOTES = next;
          setQuotes({ ...next });
          setDataV(v => v + 1);
        }
      } catch {}
    };

    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [positions]);

  return { positions, setPositions, quotes, dataV };
}

// =============================================================
// MOBILE FRAME — 390 × 844
// =============================================================
function MobileFrame({ children, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {label && (
        <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.16em' }}>
          {label}
        </div>
      )}
      <div className="mobile-frame" style={{ borderRadius: 36, border: '6px solid #0a0a0d', boxShadow: '0 0 0 1px var(--border-2), 0 24px 60px rgba(0,0,0,0.5)' }}>
        <div className="mobile-shell" style={{ borderRadius: 30, overflow: 'hidden', background: 'var(--bg-0)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function MobileStatusbar() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const upd = () => setTime(new Date().toLocaleTimeString('en-SG', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }));
    upd();
    const id = setInterval(upd, 10000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mobile-statusbar" style={{ paddingTop: 12 }}>
      <div className="si">{time || '9:41'}</div>
      <div className="si" style={{ gap: 6 }}>
        <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor">
          <rect x="0" y="6" width="3" height="4"/><rect x="4" y="4" width="3" height="6"/>
          <rect x="8" y="2" width="3" height="8"/><rect x="12" y="0" width="3" height="10"/>
        </svg>
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none" stroke="currentColor">
          <rect x="0.5" y="0.5" width="18" height="10" rx="2"/>
          <rect x="2" y="2" width="14" height="7" fill="currentColor"/>
          <rect x="19.5" y="3.5" width="1.5" height="4" fill="currentColor"/>
        </svg>
      </div>
    </div>
  );
}

function MobileTabbar({ active, onChange }) {
  const tabs = [
    { id: 'portfolio', label: 'Portfolio', icon: 'holdings' },
    { id: 'intel',     label: 'Intel',     icon: 'intel' },
    { id: 'scout',     label: 'Scout',     icon: 'scout' },
    { id: 'detail',    label: 'DD',        icon: 'eye' },
    { id: 'settings',  label: 'Settings',  icon: 'settings' },
  ];
  return (
    <div className="mobile-tabbar">
      {tabs.map(t => (
        <div key={t.id} className={`mobile-tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          <Icon name={t.icon} size={18} />
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// =============================================================
// PORTFOLIO SCREEN
// =============================================================
function MobilePortfolio({ positions, quotes }) {
  const totals = useMemo(() => {
    let nlv = 0, cost = 0, dayPnl = 0;
    positions.forEach(p => {
      const q = quotes[p.ticker] || {};
      nlv += (q.px || 0) * p.qty;
      cost += p.avg * p.qty;
      dayPnl += (q.dAbs || 0) * p.qty;
    });
    const unreal = nlv - cost;
    return { nlv, unreal, unrealPct: cost ? (unreal / cost) * 100 : 0, dayPnl, count: positions.length };
  }, [positions, quotes]);

  const enriched = useMemo(() => positions.map(p => {
    const q = quotes[p.ticker] || {};
    const mv = (q.px || 0) * p.qty;
    const upnl = ((q.px || 0) - p.avg) * p.qty;
    const upnlPct = p.avg > 0 ? ((q.px || 0) / p.avg - 1) * 100 : 0;
    return { ...p, ...q, mv, upnl, upnlPct };
  }).sort((a, b) => b.mv - a.mv), [positions, quotes]);

  const dayPnlPct = (totals.nlv - totals.dayPnl) > 0 ? (totals.dayPnl / (totals.nlv - totals.dayPnl)) * 100 : 0;

  return (
    <div className="mobile-screen">
      <div className="mscreen-header" style={{ paddingBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="mscreen-title">Portfolio NLV</div>
          <SrcPill src="live" age="now" />
        </div>
        <div className="mscreen-bignum tabular">{fmtMoney(totals.nlv)}</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginTop: 4 }}>
          <div className={`mscreen-sub ${sign(totals.dayPnl)}`}>
            {totals.dayPnl >= 0 ? '+' : ''}{fmtUSDC(totals.dayPnl)} ({fmtPct(dayPnlPct)})
          </div>
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Today</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--border-1)' }}>
            <div className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Unreal P&L</div>
            <div className={`mono ${sign(totals.unreal)}`} style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
              {totals.unreal >= 0 ? '+' : ''}{fmtUSDC(totals.unreal)}
            </div>
          </div>
          <div style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--border-1)' }}>
            <div className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Positions</div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: 'var(--fg-0)' }}>{positions.length}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid var(--border-1)' }}>
        <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.16em' }}>
          Holdings · {positions.length}
        </div>
        <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.16em' }}>By value ▾</div>
      </div>

      <div>
        {enriched.map(p => (
          <div key={p.ticker} className="m-position">
            <div className="m-pos-left">
              <div className="m-pos-tk">
                <span className={`broker-dot ${(p.broker || '') === 'Tiger' ? 'tiger' : ''}`} />
                {p.ticker}
              </div>
              <div className="m-pos-nm">{p.name}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <Sparkline data={window.SPARKS?.[p.ticker]} w={64} h={14} />
                <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em' }}>{p.qty}@{fmtUSD(p.avg)}</span>
              </div>
            </div>
            <div className="m-pos-right">
              <div className="m-pos-px tabular">{fmtMoney(p.px || 0, 2)}</div>
              <div className={`m-pos-pnl ${sign(p.dPct || 0)}`}>{fmtPct(p.dPct || 0)}</div>
              <div className={`mono ${sign(p.upnl)}`} style={{ fontSize: 10, marginTop: 2, fontWeight: 500 }}>
                {p.upnl >= 0 ? '+' : ''}{fmtUSDC(p.upnl)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================
// INTEL SCREEN
// =============================================================
function _parseAgoMs(t) {
  const m = (t || '').match(/^(\d+)(m|h|d)$/);
  if (!m) return 0;
  return +m[1] * (m[2] === 'm' ? 60000 : m[2] === 'h' ? 3600000 : 86400000);
}
const _NEWS_PERIOD_SECS = { '1D': 86400, '1W': 604800, '1M': 2592000 };
function _agoToSec(t) {
  const m = (t || '').match(/(\d+)\s*(m|h|d)/);
  if (!m) return 0;
  return +m[1] * (m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 86400);
}
function _effectiveTs(n) {
  if (n.datetime >= 1000000000 && n.datetime <= 2000000000) return n.datetime;
  const age = _agoToSec(n.t || n.ago);
  if (age > 0) return Math.floor(Date.now() / 1000) - age;
  return Math.floor(Date.now() / 1000);
}
function _applyNewsFilters(items, period, sortMode) {
  const cutoff = _NEWS_PERIOD_SECS[period] || _NEWS_PERIOD_SECS['1W'];
  const nowSec = Date.now() / 1000;
  const withTs = items.map(n => ({ ...n, _ts: _effectiveTs(n) }));
  const filtered = withTs.filter(n => (nowSec - n._ts) < cutoff);
  return sortMode === 'rank'
    ? [...filtered].sort((a, b) => (b.importance || 0) - (a.importance || 0))
    : [...filtered].sort((a, b) => b._ts - a._ts);
}

function MobileIntel() {
  const [tab, setTab] = useState('synthesis');
  const [synthTab, setSynthTab] = useState('catalysts');
  const [newsPeriod, setNewsPeriod] = useState('1W');
  const [newsSortMode, setNewsSortMode] = useState('rank');
  const [newsTab, setNewsTab] = useState('portfolio');
  const [livePortfolio, setLivePortfolio] = useState(null);
  const [liveWire, setLiveWire] = useState(null);
  const [newsSrc, setNewsSrc] = useState('loading');
  const tabs = ['synthesis','news','filings','macro'];
  const synthesis = window.SYNTHESIS || { catalysts: [], risks: [], macro: [] };
  const ms = window.MACRO_SERIES || { nav: [], spx: [] };

  useEffect(() => {
    let iv = null;
    const restoreLS = (key, setter) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const { items, savedAt } = JSON.parse(raw);
        if (!Array.isArray(items) || Date.now() - savedAt > 3600000) return false;
        setter(items);
        return true;
      } catch { return false; }
    };
    const start = () => {
      const tickers = (window.POSITIONS || []).map(p => p.ticker).filter(Boolean);
      if (!tickers.length) return;
      const qs = tickers.join(',');
      const hadP = restoreLS(`se:news:v2:${qs}`, setLivePortfolio);
      const hadW = restoreLS(`se:wire:v2:${qs}`, setLiveWire);
      if (hadP || hadW) setNewsSrc('cached');
      const load = () => {
        Promise.all([
          fetch(`/api/news?tickers=${qs}&v=12`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/wire?tickers=${qs}&v=7`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([news, wire]) => {
          if (Array.isArray(news) && news.length) {
            const m = news.map(d => ({ tk: d.ticker, headline: d.headline, src: d.source, t: d.ago, macro: false, url: d.url||'', importance: d.importance||50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment||'neutral' }));
            setLivePortfolio(m);
            try { localStorage.setItem(`se:news:v2:${qs}`, JSON.stringify({ items: m, savedAt: Date.now() })); } catch {}
          } else if (Array.isArray(news)) {
            setLivePortfolio([]);
          }
          if (Array.isArray(wire) && wire.length) {
            const m = wire.map(d => ({ tk: d.ticker_or_sector, headline: d.headline, src: d.source, t: d.ago, macro: d.tag !== 'TICKER', url: d.url||'', importance: d.importance||50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment||'neutral' }));
            setLiveWire(m);
            try { localStorage.setItem(`se:wire:v2:${qs}`, JSON.stringify({ items: m, savedAt: Date.now() })); } catch {}
          } else if (Array.isArray(wire)) {
            setLiveWire([]);
          }
          setNewsSrc('live');
        }).catch(() => setNewsSrc('live'));
      };
      if (iv) clearInterval(iv);
      load();
      iv = setInterval(load, 15 * 60 * 1000);
    };
    start();
    window.addEventListener('se:positions', start, { once: true });
    return () => { clearInterval(iv); window.removeEventListener('se:positions', start); };
  }, []);

  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div className="mscreen-title">Intelligence</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="mscreen-bignum" style={{ fontSize: 22 }}>
            {tab === 'synthesis' ? 'Synthesis' : tab === 'news' ? 'News' : tab === 'filings' ? 'Filings' : 'Macro'}
          </div>
          <SrcPill src={tab === 'news' ? (newsSrc === 'loading' ? 'seed' : newsSrc) : 'seed'} age={tab === 'news' && newsSrc === 'live' ? 'now' : 'seed'} />
        </div>
      </div>
      <div className="m-tabs">
        {tabs.map(t => (
          <div key={t} className={`m-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</div>
        ))}
      </div>

      {tab === 'synthesis' && (
        <>
          <div style={{ display: 'flex', gap: 6, padding: '14px 20px 0' }}>
            {['catalysts','risks','macro'].map(k => (
              <button key={k} className="mono"
                style={{
                  padding: '6px 12px', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                  border: '1px solid var(--border-2)', cursor: 'pointer',
                  background: synthTab === k ? 'var(--bg-3)' : 'transparent',
                  color: synthTab === k ? 'var(--fg-0)' : 'var(--fg-3)',
                }}
                onClick={() => setSynthTab(k)}>{k}
              </button>
            ))}
          </div>
          <div style={{ padding: 16 }}>
            {(synthesis[synthTab] || []).map((it, i) => (
              <div key={i} className="intel-item">
                <div className="intel-num">0{i + 1}</div>
                <div>
                  <div className="intel-body"><span className="tag">{it.tag}</span>{it.body}</div>
                  {it.meta && <div className="intel-meta">{it.meta}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'news' && (() => {
        const mobileRaw = newsTab === 'portfolio' ? livePortfolio : liveWire;
        const mobileList = mobileRaw ? _applyNewsFilters(mobileRaw, newsPeriod, newsSortMode) : null;
        return (
          <div style={{ padding: '0 20px' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '10px 0 4px' }}>
              {['portfolio','wire'].map(nt => (
                <span key={nt} className={`news-filter-btn ${newsTab === nt ? 'active' : ''}`}
                      onClick={() => setNewsTab(nt)} style={{ textTransform: 'capitalize' }}>{nt}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '0 0 6px' }}>
              {['1D','1W','1M'].map(p => (
                <span key={p} className={`news-filter-btn ${newsPeriod === p ? 'active' : ''}`}
                      onClick={() => setNewsPeriod(p)}>{p}</span>
              ))}
              <span className="news-sort-btn"
                    onClick={() => setNewsSortMode(s => s === 'rank' ? 'time' : 'rank')}>
                {newsSortMode === 'rank' ? '↕ Rank' : '↕ Time'}
              </span>
            </div>
            {!mobileList ? (
              <div className="news-loading" style={{ height: 200 }}>
                <div className="news-spinner" />
                <span>Loading news…</span>
              </div>
            ) : mobileList.length === 0 ? (
              <div className="news-loading" style={{ height: 120 }}><span>No items in this period</span></div>
            ) : mobileList.map((n, i) => {
              const tier = (n.importance || 50) >= 80 ? 'top' : (n.importance || 50) >= 60 ? 'mid' : 'low';
              return (
                <div className={`news-item news-tier-${tier}`} key={i}
                     style={{ gridTemplateColumns: '28px 40px 1fr 32px', padding: '10px 0' }}>
                  <div className="news-score">{n.importance || 50}</div>
                  <div className={`news-tk${n.macro ? ' macro' : ''}`}>{n.tk}</div>
                  <div className="news-body">
                    <div className="news-headline">
                      {n.url
                        ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                        : n.headline}
                    </div>
                    {n.why && <div className="news-why">{n.why}</div>}
                    <div className="news-meta">
                      {n.sentiment && <span className={`news-sent news-sent-${n.sentiment}`}>{n.sentiment === 'bull' ? '▲ BULL' : n.sentiment === 'bear' ? '▼ BEAR' : '— NEU'}</span>}
                      {n.src}
                    </div>
                  </div>
                  <div className="news-time">{n.t}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {tab === 'filings' && (
        <div style={{ padding: '0 20px' }}>
          {(window.SEC_FILINGS || []).map((f, i) => (
            <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--border-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span className="filing-form">{f.form}</span>
                <span className="filing-tk">{f.tk}</span>
                <span className={`sent ${f.sent}`} style={{ marginLeft: 'auto' }}>{f.sent}</span>
              </div>
              <div className="filing-tldr">{f.tldr}</div>
              {f.when && <div className="mono dim" style={{ fontSize: 10, marginTop: 6, letterSpacing: '0.08em' }}>{f.when} ago</div>}
            </div>
          ))}
        </div>
      )}

      {tab === 'macro' && (
        <div style={{ padding: 16 }}>
          <div className="chart-legend">
            <span><span className="dot" style={{ background: 'var(--acc)' }} /> NAV</span>
            <span><span className="dot" style={{ background: 'var(--fg-3)' }} /> SPX</span>
          </div>
          <MacroChart nav={ms.nav} spx={ms.spx} w={350} h={200} />
        </div>
      )}
    </div>
  );
}

// =============================================================
// SCOUT SCREEN — live from /api/dd/scouts
// =============================================================
function MobileScout() {
  const [scouts, setScouts] = useState(window.SCOUTS || []);
  const [src, setSrc] = useState((window.SCOUTS || []).length ? 'seed' : 'loading');

  useEffect(() => {
    fetch('/api/dd/scouts')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length) {
          setScouts(d.map(s => ({
            tk: s.ticker || s.tk || '—',
            score: s.score ?? 0,
            grade: (s.grade ?? 'HOLD').replace(/ /g, '-').toUpperCase(),
            sector: s.sector || '—',
            valPath: s.path || '—',
            rationale: s.gemma_rationale || s.rationale || s.thesis || '—',
            filters: s.matched_filters || [],
          })));
          setSrc('live');
        } else if (src === 'loading') {
          setSrc('seed');
        }
      })
      .catch(() => { if (src === 'loading') setSrc('seed'); });
  }, []);

  const display = scouts.length ? scouts : (window.SCOUTS || []);
  const nextRun = (() => {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return et.getHours() < 6 ? '06:00 ET today' : '06:00 ET tomorrow';
  })();

  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="mscreen-title">Scout</div>
          <SrcPill src={src === 'loading' ? 'cached' : src} age={src === 'loading' ? '…' : 'now'} />
        </div>
        <div className="mscreen-bignum" style={{ fontSize: 22 }}>BUY Signals</div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 4, letterSpacing: '0.06em' }}>
          {display.length} tickers · screened nightly
        </div>
      </div>

      {!display.length ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-3)' }}>
          <div className="mono uppercase" style={{ fontSize: 11, marginBottom: 8 }}>Scout is hunting</div>
          <div style={{ fontSize: 12 }}>Next run {nextRun}</div>
        </div>
      ) : (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {display.map((s, i) => (
            <div key={s.tk} className={`scout-card ${(s.grade || '').toLowerCase().replace(' ','-')}${i === 0 ? ' featured' : ''}`}>
              <div className="scout-card-top">
                <span className="scout-tk">{s.tk}</span>
                <span className="scout-score">{(+s.score).toFixed(1)}<span className="denom"> /10</span></span>
              </div>
              <div className="scout-grade">{s.grade}</div>
              <div className="scout-rationale">{s.rationale}</div>
              <div className="scout-chips">
                {(s.filters || []).map((f, j) => (
                  <span className={`chip ${j === (s.filters.length - 1) ? 'acc' : ''}`} key={f}>{f}</span>
                ))}
              </div>
              <div className="scout-meta"><span>{s.sector}</span><span>Path {s.valPath}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================
// DETAIL / DD SCREEN — loads from KV, triggers real analysis
// =============================================================
function MobileDetail() {
  const [input, setInput] = useState('AVGO');
  const [phase, setPhase] = useState('result'); // idle | running | result | error
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [ticker, setTicker] = useState('AVGO');
  const pollRef = useRef(null);
  const elapsedRef = useRef(null);

  function mapResult(data) {
    if (!data) return null;
    const d = data.result || data;
    const score = d.consensus_score ?? d.score ?? 0;
    const grade = (d.consensus_grade ?? d.grade ?? 'HOLD').toUpperCase();
    return {
      ticker: d.ticker || ticker,
      score, grade,
      confidence: d.confidence ?? 'MEDIUM',
      asOf: d.asOf || 'now',
      thesis: d.majority_thesis ?? d.thesis ?? '',
      swing: d.key_swing_factor ?? d.swing ?? '',
      dissent: d.dissent ?? '',
      agents: (d.agents || []).map(a => ({
        name: a.role ?? a.agent ?? a.name ?? 'Agent',
        vote: ['BUY','BULL','STRONG BUY'].includes((a.signal ?? a.vote ?? '').toUpperCase()) ? 'BULL'
          : ['SELL','BEAR'].includes((a.signal ?? a.vote ?? '').toUpperCase()) ? 'BEAR' : 'NEUTRAL',
        rationale: a.rationale ?? a.text ?? '',
      })),
    };
  }

  // Load KV result for initial ticker
  useEffect(() => {
    fetch('/api/dd/avgo')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const mapped = mapResult(d);
        if (mapped) { setResult(mapped); setPhase('result'); }
        else if (!window.DD_RESULT) { setPhase('idle'); }
        else { setResult(mapResult(window.DD_RESULT)); setPhase('result'); }
      })
      .catch(() => {
        if (window.DD_RESULT) { setResult(mapResult(window.DD_RESULT)); setPhase('result'); }
        else setPhase('idle');
      });
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
  }, []);

  async function analyze() {
    const tk = input.trim().toUpperCase();
    if (!tk) return;
    setTicker(tk);
    setPhase('running');
    setElapsed(0);
    if (pollRef.current) clearInterval(pollRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);

    const start = Date.now();
    elapsedRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try { await fetch('/api/dd/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: tk }) }); } catch {}

    const poll = async () => {
      try {
        const r = await fetch(`/api/dd/${tk.toLowerCase()}`);
        if (r.ok) {
          const data = await r.json();
          const d = data?.result || data;
          if (data && (d.consensus_score != null || d.score != null)) {
            clearInterval(pollRef.current); clearInterval(elapsedRef.current);
            const mapped = mapResult(data);
            if (mapped) { setResult(mapped); setPhase('result'); }
          }
        }
      } catch {}
    };
    setTimeout(() => { poll(); pollRef.current = setInterval(poll, 15_000); }, 5_000);
  }

  const display = result || (window.DD_RESULT ? mapResult(window.DD_RESULT) : null);
  const agentKinds = ['valuation','macro','techanalysis','fundforensics','marketstructure'];

  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div className="mscreen-title">Sovereign DD</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="TICKER"
            disabled={phase === 'running'}
            style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--border-2)', color: 'var(--fg-0)', fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.1em' }}
          />
          <button className="btn btn-primary" onClick={analyze} disabled={phase === 'running' || !input.trim()} style={{ padding: '8px 16px' }}>
            {phase === 'running' ? `${elapsed}s…` : 'Analyze'}
          </button>
        </div>
        {display && phase !== 'running' && (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 }}>
            <div className="mscreen-bignum">{display.ticker}</div>
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--fg-0)', lineHeight: 1 }}>
                {(+display.score).toFixed(1)}<span style={{ fontSize: 14, color: 'var(--fg-3)' }}> /10</span>
              </div>
              <div className={`dd-grade ${display.grade.toLowerCase().replace(/\s+/g,'-')}`} style={{ marginTop: 6 }}>{display.grade}</div>
            </div>
          </div>
        )}
      </div>

      {phase === 'running' && (
        <div style={{ padding: 16 }}>
          <div className="debate-room">
            <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--acc)', letterSpacing: '0.14em', marginBottom: 8 }}>
              ▶ debate · {ticker}
            </div>
            <div className="debate-grid" style={{ gap: 6 }}>
              {agentKinds.map((k, i) => (
                <div key={k} className={`agent ${i < Math.floor(elapsed * 0.3) ? 'thinking' : ''}`}>
                  <AgentPixel kind={k} talking={i < Math.floor(elapsed * 0.3)} />
                  <div className="agent-name">{k}</div>
                </div>
              ))}
            </div>
            <div className="debate-progress" style={{ marginTop: 12 }}>
              <i style={{ width: `${Math.min(100, (elapsed / 600) * 100)}%` }} />
            </div>
            <div className="mono dim" style={{ fontSize: 10, textAlign: 'center', marginTop: 8 }}>
              Running via GitHub Actions · 5–10 min
            </div>
          </div>
        </div>
      )}

      {(phase === 'result' || (phase === 'idle' && display)) && display && (
        <div style={{ padding: 16 }}>
          <div className="dd-section">
            <div className="dd-section-label">Thesis</div>
            <div className="dd-thesis">{display.thesis}</div>
          </div>
          {display.swing && (
            <div className="dd-section">
              <div className="dd-section-label">Key Swing Factor</div>
              <div className="dd-swing">{display.swing}</div>
            </div>
          )}
          {display.dissent && (
            <div className="dd-section">
              <div className="dd-section-label">Dissent</div>
              <div className="dd-dissent">{display.dissent}</div>
            </div>
          )}
          {display.agents?.length > 0 && (
            <div className="dd-section">
              <div className="dd-section-label">Agent Votes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {display.agents.map((a, i) => (
                  <div key={i} className="dd-agent" style={{ display: 'grid', gridTemplateColumns: 'auto 60px 1fr', gap: 10, alignItems: 'start' }}>
                    <div style={{ width: 28, height: 28 }}><AgentPixel kind={agentKinds[i % agentKinds.length]} /></div>
                    <div>
                      <div className="ag-name">{a.name}</div>
                      <div className={`ag-vote ${(a.vote || '').toLowerCase()}`}>{a.vote}</div>
                    </div>
                    <div className="ag-rationale">{a.rationale}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'idle' && !display && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 12 }}>
          Enter a ticker above and press Analyze.
        </div>
      )}
    </div>
  );
}

// =============================================================
// SETTINGS SCREEN — real import + system health
// =============================================================
function SettingsGroup({ title, children }) {
  return (
    <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-1)' }}>
      <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.16em', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MobileSettings({ positions, setPositions }) {
  const [step, setStep] = useState('idle'); // idle | parse | diff | saving | saved | error
  const [progress, setProgress] = useState(0);
  const [diff, setDiff] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [broker, setBroker] = useState('');
  const [partial, setPartial] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [checked, setChecked] = useState({});
  const fileRef = useRef(null);

  function computeDiff(current, inc) {
    const curMap = new Map((current || []).map(p => [p.ticker, p]));
    const incMap = new Map((inc || []).map(p => [p.ticker, p]));
    const adds = [], upds = [], rems = [];
    inc.forEach(p => {
      if (!curMap.has(p.ticker)) adds.push({ kind: 'add', ...p });
      else {
        const e = curMap.get(p.ticker);
        if (Math.abs(e.qty - p.qty) > 0.001 || Math.abs((e.avg||0) - p.avg) > 0.01)
          upds.push({ kind: 'upd', ...p, oldQty: e.qty, oldAvg: e.avg || 0 });
      }
    });
    current.forEach(p => { if (!incMap.has(p.ticker)) rems.push({ kind: 'rem', ...p }); });
    return { adds, upds, rems };
  }

  async function parseFile(file) {
    if (!file?.type?.startsWith('image/')) return;
    setStep('parse');
    setProgress(0);
    let prog = 0;
    const pt = setInterval(() => { prog = Math.min(prog + 5 + Math.random() * 6, 88); setProgress(prog); }, 180);
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result.split(',')[1]);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const r = await fetch('/api/portfolio/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: base64, mimeType: file.type || 'image/jpeg' }),
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw new Error(result.error || `HTTP ${r.status}`);
      clearInterval(pt);
      setProgress(100);
      const d = computeDiff(positions, result.positions || []);
      setIncoming(result.positions || []);
      setDiff(d);
      setBroker(result.broker || 'Unknown');
      setPartial(result.partial || false);
      const sel = {};
      d.adds.forEach(p => { sel[p.ticker] = true; });
      d.upds.forEach(p => { sel[p.ticker] = true; });
      d.rems.forEach(p => { sel[p.ticker] = false; });
      setChecked(sel);
      setTimeout(() => setStep('diff'), 300);
    } catch (e) {
      clearInterval(pt);
      setErrMsg(e.message || 'Parse failed');
      setStep('error');
    }
  }

  async function save() {
    if (!diff || !incoming) return;
    setStep('saving');
    const curMap = new Map(positions.map(p => [p.ticker, p]));
    diff.adds.forEach(p => { if (checked[p.ticker]) curMap.set(p.ticker, p); });
    diff.upds.forEach(p => {
      if (checked[p.ticker]) {
        const ex = curMap.get(p.ticker) || {};
        curMap.set(p.ticker, { ...ex, ...p, sector: p.sector || ex.sector || '', industry: p.industry || ex.industry || '' });
      }
    });
    diff.rems.forEach(p => { if (checked[p.ticker]) curMap.delete(p.ticker); });
    const merged = [...curMap.values()];
    try {
      const r = await fetch('/api/positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!r.ok) throw new Error(`Save failed HTTP ${r.status}`);
      setPositions(merged.map(p => ({ ...p, avg: p.avg ?? 0 })));
      setStep('saved');
    } catch (e) {
      setErrMsg(e.message); setStep('error');
    }
  }

  const allRows = diff ? [...diff.adds, ...diff.upds, ...diff.rems] : [];
  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div className="mscreen-title">Settings</div>
      </div>

      {/* Import from screenshot */}
      <div className="m-import-hero">
        <div className="m-import-hero-icon"><Icon name="image" size={22} /></div>
        <h3>Import from Screenshot</h3>
        <p>Take a screenshot of your broker app and let Gemini extract your positions.</p>

        {step === 'idle' && (
          <>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => parseFile(e.target.files[0])} />
            <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 6 }}
              onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> Choose screenshot
            </button>
          </>
        )}

        {step === 'parse' && (
          <div style={{ width: '100%', marginTop: 6 }}>
            <div className="parse-status" style={{ justifyContent: 'center', padding: '6px 0' }}>
              <div className="parse-spinner" /><div>Parsing positions…</div>
            </div>
            <div style={{ height: 3, background: 'var(--bg-3)' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--acc), var(--acc-2))', transition: 'width 180ms' }} />
            </div>
          </div>
        )}

        {step === 'diff' && diff && (
          <div style={{ width: '100%', textAlign: 'left', marginTop: 6 }}>
            {partial && (
              <div style={{ fontSize: 11, color: 'var(--warn,#f59e0b)', marginBottom: 8 }}>
                ⚠ Partial screenshot — uncheck removals you haven't sold.
              </div>
            )}
            <div className="diff-summary" style={{ justifyContent: 'center' }}>
              <div className="adds">+ {diff.adds.length}</div>
              <div className="upds">~ {diff.upds.length}</div>
              <div className="rems">− {diff.rems.length}</div>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-1)', background: 'var(--bg-2)', marginBottom: 10 }}>
              {allRows.map((r, i) => (
                <label key={i} className={`diff-row ${r.kind}`} style={{ gridTemplateColumns: '18px 60px 1fr', padding: '8px 10px', display: 'grid', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!checked[r.ticker]}
                    onChange={e => setChecked(s => ({ ...s, [r.ticker]: e.target.checked }))} />
                  <span className="diff-tk">{r.ticker}</span>
                  <span style={{ fontSize: 11 }}>
                    {r.kind === 'add' && 'new'}
                    {r.kind === 'upd' && `qty ${r.oldQty}→${r.qty}`}
                    {r.kind === 'rem' && 'remove'}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setStep('idle')}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={save} disabled={checkedCount === 0}>
                Save {checkedCount} change{checkedCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="parse-status" style={{ justifyContent: 'center', marginTop: 10 }}>
            <div className="parse-spinner" /><div>Saving…</div>
          </div>
        )}

        {step === 'saved' && (
          <div style={{ width: '100%', textAlign: 'center', marginTop: 6 }}>
            <div className="mono pos" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              ✓ Imported · KV synced
            </div>
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setStep('idle')}>Done</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ width: '100%', marginTop: 6 }}>
            <div className="mono" style={{ color: 'var(--neg)', fontSize: 11, marginBottom: 8 }}>ERROR: {errMsg}</div>
            <button className="btn" style={{ width: '100%' }} onClick={() => setStep('idle')}>Retry</button>
          </div>
        )}
      </div>

      {/* System health */}
      <SettingsGroup title="System Health">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(window.API_HEALTH || []).map(api => {
            const pct = api.quota ? Math.min(100, (api.used / api.quota) * 100) : 0;
            return (
              <div key={api.id} className={`api-card ${api.status}`} style={{ padding: '10px 12px' }}>
                <div className="api-card-top">
                  <span className="api-card-name">{api.name}</span>
                  <span className={`api-card-status ${api.status}`}>
                    {api.status === 'ok' ? '● OK' : api.status === 'degraded' ? '◐ DEGR' : '✕ DOWN'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                  <span>{api.scope}</span>
                  <span className="mono" style={{ fontSize: 10 }}>{api.latency > 0 ? api.latency + 'ms' : ''}</span>
                </div>
                {api.quota > 0 && (
                  <div className={`api-quota-bar ${pct > 75 ? 'warn' : ''}`} style={{ marginTop: 6 }}>
                    <i style={{ width: pct + '%' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Portfolio Tickers">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {positions.map(p => (
            <span key={p.ticker} className="mono" style={{
              fontSize: 11, padding: '4px 7px', border: '1px solid var(--border-2)', color: 'var(--fg-1)',
            }}>{p.ticker}</span>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="KV Sync">
        <button className="btn" style={{ width: '100%' }}
          onClick={() => {
            fetch('/api/positions')
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (Array.isArray(data) && data.length)
                  setPositions(data.map(p => ({ ...p, avg: p.avg ?? 0 })));
              }).catch(() => {});
          }}>
          <Icon name="refresh" size={12} /> Force sync now
        </button>
        <div className="mono dim" style={{ fontSize: 10, marginTop: 8, letterSpacing: '0.06em' }}>
          {positions.length} positions in portfolio
        </div>
      </SettingsGroup>

      <div style={{ height: 16 }} />
    </div>
  );
}

// =============================================================
// MOBILE APP — entry point for mobile.html
// =============================================================
function MobileApp() {
  const [screen, setScreen] = useState('portfolio');
  const { positions, setPositions, quotes } = useLiveData();

  return (
    <>
      <MobileStatusbar />
      {screen === 'portfolio' && <MobilePortfolio positions={positions} quotes={quotes} />}
      {screen === 'intel'     && <MobileIntel />}
      {screen === 'scout'     && <MobileScout />}
      {screen === 'detail'    && <MobileDetail />}
      {screen === 'settings'  && <MobileSettings positions={positions} setPositions={setPositions} />}
      <MobileTabbar active={screen} onChange={setScreen} />
    </>
  );
}

window.MobileFrame = MobileFrame;
window.MobileApp = MobileApp;

// mobile.html renders standalone
if (document.getElementById('root') && !window.__DESKTOP_BOOT__) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <div style={{ display: 'flex', justifyContent: 'center', padding: 0 }}>
      <MobileApp />
    </div>
  );
}
})();
