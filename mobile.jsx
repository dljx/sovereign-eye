/* global React, ReactDOM, window, Icon, SrcPill, GaugeBar, Sparkline, AgentPixel, MacroChart,
   fmtUSD, fmtUSDC, fmtMoney, fmtPct, sign, normQ, _relDate,
   POSITIONS, QUOTES, SYNTHESIS,
   SEC_FILINGS, DD_RESULT, SCOUTS, MACRO_SERIES, SPARKS, computeTotals,
   _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry, RRChip */
(function () {
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// _fmtElapsed, _AGENT_KINDS, _DESIGN_AGENTS, _AGENT_NAME_MAP, DDTranscriptEntry
// now live in dd-shared.jsx (loaded before this script in both index/mobile.html).

// Hold-mode labels + the rich DD renderer now live in dd-shared.jsx.
const _holdLabel = window.holdLabel;
const _gradeFor = window.gradeForResult;
const DDResultFull = window.DDResultFull;

// Full-screen DD popup. Fetches the real dossier from /api/dd/{ticker}; if there
// is none yet (scout picks aren't stored per-ticker), falls back to the scout
// consensus object carried by the tapped card.
function MobileDDModal({ ticker, fallbackScout, onClose }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | scout | empty | error

  useEffect(() => {
    if (!ticker) return;
    setState('loading'); setData(null);
    let cancelled = false;
    fetch(`/api/dd/${ticker.toUpperCase()}`)
      .then(r => r.status === 404 ? { __empty: true } : (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        if (cancelled) return;
        const result = d && !d.__empty ? (d.result || d) : null;
        if (result && result.ticker) {
          setData({ ...result, _dossier: d.dossier || null }); // Evidence section
          setState('ready');
        }
        else if (fallbackScout) { setState('scout'); }
        else { setState('empty'); }
      })
      .catch(() => { if (!cancelled) setState(fallbackScout ? 'scout' : 'error'); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (!ticker) return null;
  const gradeClass = g => (g || '').toLowerCase().replace(/[\s_-]+/g, '-');
  const s = fallbackScout || {};
  const pos = s.position || null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <Icon name="research" size={16} />
          <div className="modal-title">Sovereign DD — {ticker}</div>
          <div style={{ flex: 1 }} />
          {state === 'scout' && (
            <span className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--acc)', padding: '3px 6px', border: '1px solid var(--acc)' }}>From Scout</span>
          )}
          <button className="btn-icon" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto' }}>
          {state === 'loading' && <div className="news-loading"><div className="news-spinner" /><span>Loading dossier…</span></div>}
          {state === 'empty' && <div className="news-loading"><span>No dossier yet for {ticker}. Run a full DD from the DD tab.</span></div>}
          {state === 'error' && <div className="news-loading"><span>Could not load dossier — try again.</span></div>}

          {state === 'ready' && data && <DDResultFull data={data} />}

          {state === 'scout' && (
            <>
              <div className="dd-result-header">
                <div>
                  <div className="dd-ticker">{s.tk || ticker}</div>
                  {s.conf && <div className="dd-conf">CONF: {s.conf}</div>}
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: 'right' }}>
                  <div className="dd-score">{(+(s.score || 0)).toFixed(1)}<span className="denom"> / 10</span></div>
                  <div className={`dd-grade ${gradeClass(s.grade)}`}>{(s.grade || 'HOLD').replace(/-/g, ' ')}</div>
                </div>
              </div>
              <div className="news-loading" style={{ padding: '8px 0', fontSize: 11 }}>
                <span>Scout consensus — run a full DD from the DD tab for the agent transcript.</span>
              </div>
              {s.verdict === 'DOWNGRADE' && (
                <div className="dd-section" style={{ color: 'var(--warn)' }}>
                  <div className="dd-section-label">
                    ⚠ Red-Team Flagged — DOWNGRADE{s.vscore != null ? ` · ${(+s.vscore).toFixed(1)}/10` : ''}
                  </div>
                  <div className="dd-thesis">
                    {s.reviewReason || 'Red-team review raised concerns that weren’t fatal to the thesis.'}
                  </div>
                </div>
              )}
              {s.banger?.is_banger && (
                <div className="dd-section" style={{ color: 'var(--acc)' }}>
                  <div className="dd-section-label">🔥 Banger</div>
                  <div className="dd-thesis">{s.banger.reason || 'High-conviction asymmetric setup.'}</div>
                </div>
              )}
              <div className="dd-section">
                <div className="dd-section-label">Thesis</div>
                <div className="dd-thesis">{s.thesis || s.rationale || 'No thesis recorded.'}</div>
              </div>
              {s.keySwing && (
                <div className="dd-section">
                  <div className="dd-section-label">Key Swing Factor</div>
                  <div className="dd-swing">{s.keySwing}</div>
                </div>
              )}
              {s.catalyst && (
                <div className="dd-section">
                  <div className="dd-section-label">Catalyst</div>
                  <div className="dd-dissent">{s.catalyst}</div>
                </div>
              )}
              {(s.asymmetry || pos || s.cycle) && (
                <div className="dd-section">
                  <div className="dd-section-label">Setup</div>
                  <div className="dd-thesis" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                    {s.asymmetry && <span><b>Asymmetry:</b> {s.asymmetry}</span>}
                    {pos?.range && <span><b>Position:</b> {pos.range}</span>}
                    {s.cycle?.phase && <span><b>Cycle:</b> {s.cycle.regime ? `${s.cycle.regime} — ` : ''}{s.cycle.phase}</span>}
                  </div>
                </div>
              )}
              {Array.isArray(s.filters) && s.filters.length > 0 && (
                <div className="dd-section">
                  <div className="dd-section-label">Matched Filters{s.valPath && s.valPath !== '—' ? ` · Path ${s.valPath}` : ''}</div>
                  <div className="scout-chips">
                    {s.filters.map((f, j) => <span className="chip" key={f + '-' + j}>{f}</span>)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

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
    const tickers = [...new Set((window.POSITIONS || []).map(p => p.ticker).filter(t => t && t !== 'USD'))];
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

function MobileTabbar({ active, onChange }) {
  const tabs = [
    { id: 'portfolio', label: 'Portfolio', icon: 'holdings' },
    { id: 'intel',     label: 'Intel',     icon: 'intel' },
    { id: 'scout',     label: 'Scout',     icon: 'scout' },
    { id: 'fire',      label: 'FIRE',      icon: 'fire' },
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
// Swipe-left-to-reveal-delete wrapper for list rows (uses the prebuilt
// .m-swipe / .m-swipe-del styles). Vertical movement cedes to scrolling.
function SwipeRow({ onDelete, disabled, children }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);
  const ts = e => { if (disabled) return; start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx }; setDragging(true); };
  const tm = e => {
    if (disabled || !start.current) return;
    const ddx = e.touches[0].clientX - start.current.x;
    if (Math.abs(e.touches[0].clientY - start.current.y) > 40) return;
    setDx(Math.max(-88, Math.min(0, start.current.dx + ddx)));
  };
  const te = () => { if (disabled) return; start.current = null; setDragging(false); setDx(d => (d < -44 ? -88 : 0)); };
  if (disabled) return children;
  return (
    <div className="m-swipe">
      <button className="m-swipe-del" onClick={() => { setDx(0); onDelete(); }}>DELETE</button>
      <div style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform 0.18s ease', position: 'relative', zIndex: 1, background: 'var(--bg-0)' }}
        onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}>
        {children}
      </div>
    </div>
  );
}

function MobilePortfolio({ positions, quotes, onPick, currency, onToggleCurrency, onDelete }) {
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

  // Thesis-status dots (registry editable on desktop; display-only here)
  const [theses, setTheses] = useState({});
  useEffect(() => {
    fetch('/api/dd/thesis').then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d === 'object') setTheses(d); })
      .catch(() => {});
  }, []);

  const dayPnlPct = (totals.nlv - totals.dayPnl) > 0 ? (totals.dayPnl / (totals.nlv - totals.dayPnl)) * 100 : 0;

  return (
    <div className="mobile-screen">
      <div className="mscreen-header" style={{ paddingBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="mscreen-title">Portfolio NLV</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onToggleCurrency && (
              <div className="ccy-toggle">
                {['USD','SGD'].map(c => (
                  <button key={c} className={`ccy-btn ${currency === c ? 'active' : ''}`}
                    onClick={() => onToggleCurrency(c)}>{c}</button>
                ))}
              </div>
            )}
            <SrcPill src="live" age="now" />
          </div>
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
        {!enriched.length && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--fg-2)', fontSize: 12 }}>
            No positions yet — import your portfolio from the <b>Settings</b> tab.
          </div>
        )}
        {enriched.map(p => (
          // ticker+broker key: a name held at two brokers is two real rows —
          // a bare-ticker key duplicates React keys (phantom empty row).
          <SwipeRow key={`${p.ticker}-${p.broker || ''}`} disabled={!onDelete || p.ticker === 'USD'}
            onDelete={() => onDelete(p.ticker)}>
          <div className="m-position"
            onClick={() => onPick && p.ticker !== 'USD' && onPick(p.ticker)}
            title={`Open DD for ${p.ticker}`}
            style={{ cursor: 'pointer' }}>
            <div className="m-pos-left">
              <div className="m-pos-tk">
                <span className={`broker-dot ${(p.broker || '') === 'Tiger' ? 'tiger' : ''}`} />
                {p.ticker}
                {(() => {
                  const t = theses[p.ticker];
                  const c = t && { INTACT: 'var(--pos)', STRAINED: 'var(--warn)', BROKEN: 'var(--neg)' }[t.status];
                  return c ? <span className="thesis-dot" style={{ background: c, marginLeft: 6 }}
                                   title={`Thesis ${t.status}${t.reason ? ` — ${t.reason}` : ''}`} /> : null;
                })()}
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
          </SwipeRow>
        ))}
      </div>
    </div>
  );
}

// =============================================================
// INTEL SCREEN
// =============================================================
// Time/decay/filter logic shared with desktop — see dd-shared.jsx NewsUtils.
const _parseAgoMs = window.NewsUtils.parseAgoMs;
const _decayImp = window.NewsUtils.decayImp;
const _applyNewsFilters = window.NewsUtils.applyNewsFilters;

function MobileIntel() {
  const [tab, setTab] = useState('synthesis');
  const [synthTab, setSynthTab] = useState('catalysts');
  const [newsPeriod, setNewsPeriod] = useState('1W');
  const [newsSortMode, setNewsSortMode] = useState('rank');
  const [newsTab, setNewsTab] = useState('portfolio');
  const [livePortfolio, setLivePortfolio] = useState(null);
  const [liveWire, setLiveWire] = useState(null);
  const [newsSrc, setNewsSrc] = useState('loading');
  const [liveSynth, setLiveSynth] = useState(null);
  const [synthSrc, setSynthSrc] = useState('seed');
  const tabs = ['synthesis','news','filings','macro'];
  const [liveMs, setLiveMs] = useState(null);
  useEffect(() => {   // live NAV series (broker TWR + VWRA when available)
    fetch('/api/nav-history')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.nav?.length && d?.spx?.length) setLiveMs(d); })
      .catch(() => {});
  }, []);
  const ms = liveMs || window.MACRO_SERIES || { nav: [], spx: [] };

  // Normalize live (or seeded) synthesis into {tag, body, meta} items per bucket.
  const synthesis = useMemo(() => {
    const norm = (arr, k) => (arr || []).map(item =>
      typeof item === 'string'
        ? { tag: k.slice(0, 4).toUpperCase(), body: item, meta: '' }
        : { tag: item.tag || k.slice(0, 4).toUpperCase(), body: item.body || item.text || '', meta: item.meta || '' });
    const src = liveSynth || window.SYNTHESIS || {};
    return { catalysts: norm(src.catalysts, 'catalysts'), risks: norm(src.risks, 'risks'), macro: norm(src.macro, 'macro') };
  }, [liveSynth]);

  // Live portfolio synthesis (catalysts/risks/macro) — mirrors desktop IntelPanel.
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
              setLiveSynth(d);
              setSynthSrc(d.cached ? 'cached' : 'live');
            }
          })
          .catch(() => {});
      load();
      interval = setInterval(load, 5 * 60 * 1000);
    };
    start();
    window.addEventListener('se:positions', start, { once: true });
    return () => { window.removeEventListener('se:positions', start); if (interval) clearInterval(interval); };
  }, []);

  useEffect(() => {
    let iv = null;
    let rescore = null;
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
      const tickers = [...new Set((window.POSITIONS || []).map(p => p.ticker).filter(Boolean))];
      if (!tickers.length) return;
      const qs = tickers.join(',');
      const hadP = restoreLS(`se:news:v4:${qs}`, setLivePortfolio);
      const hadW = restoreLS(`se:wire:v4:${qs}`, setLiveWire);
      if (hadP || hadW) setNewsSrc('cached');
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
            const m = news.map(d => ({ tk: d.ticker, headline: d.headline, src: d.source, t: d.ago, macro: false, url: d.url||'', importance: d.importance??50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment??'neutral', _scoring: !!d._scoring }));
            setLivePortfolio(m);
            try { localStorage.setItem(`se:news:v4:${qs}`, JSON.stringify({ items: m, savedAt: Date.now() })); } catch {}
          } else if (Array.isArray(news) && newsRes.status !== 'scoring') {
            setLivePortfolio([]);
          }
          if (Array.isArray(wire) && wire.length) {
            const m = wire.map(d => ({ tk: d.ticker_or_sector, headline: d.headline, src: d.source, t: d.ago, macro: d.tag !== 'TICKER', url: d.url||'', importance: d.importance??50, why: d.why||'', datetime: d.datetime||0, sentiment: d.sentiment??'neutral', _scoring: !!d._scoring }));
            setLiveWire(m);
            try { localStorage.setItem(`se:wire:v4:${qs}`, JSON.stringify({ items: m, savedAt: Date.now() })); } catch {}
          } else if (Array.isArray(wire) && wireRes.status !== 'scoring') {
            setLiveWire([]);
          }
          // Pill honesty (see desktop) — never label a dead fetch as live.
          const anyOk   = newsRes.items !== null || wireRes.items !== null;
          const scoring = newsRes.status === 'scoring' || wireRes.status === 'scoring';
          setNewsSrc(!anyOk ? 'error' : scoring ? 'cached' : 'live');
          if (scoring && scoreAttempts < 2) {
            scoreAttempts++;
            if (rescore) clearTimeout(rescore);
            rescore = setTimeout(() => load(true), 60000);
          }
        }).catch(() => setNewsSrc('error'));
      };
      if (iv) clearInterval(iv);
      load(false);
      iv = setInterval(() => load(false), 15 * 60 * 1000);
    };
    start();
    window.addEventListener('se:positions', start, { once: true });
    return () => { clearInterval(iv); if (rescore) clearTimeout(rescore); window.removeEventListener('se:positions', start); };
  }, []);

  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div className="mscreen-title">Intelligence</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="mscreen-bignum" style={{ fontSize: 22 }}>
            {tab === 'synthesis' ? 'Synthesis' : tab === 'news' ? 'News' : tab === 'filings' ? 'Filings' : 'Macro'}
          </div>
          <SrcPill
            src={tab === 'news' ? (newsSrc === 'loading' ? 'seed' : newsSrc) : tab === 'synthesis' ? synthSrc : 'seed'}
            age={tab === 'news' ? (newsSrc === 'live' ? 'now' : 'seed') : tab === 'synthesis' ? (synthSrc === 'live' ? 'now' : synthSrc) : 'seed'} />
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
              const disp = n._scoring ? null : _decayImp(n.importance, n._ts);
              const tier = n._scoring ? 'low' : disp >= 80 ? 'top' : disp >= 60 ? 'mid' : 'low';
              return (
                <div className={`news-item news-tier-${tier}`} key={i}
                     style={{ gridTemplateColumns: '28px 40px 1fr 32px', padding: '10px 0' }}>
                  {n._scoring
                    ? <div className="news-score news-score-scoring" title="AI scoring in progress">···</div>
                    : <div className="news-score">{disp}</div>
                  }
                  <div className={`news-tk${n.macro ? ' macro' : ''}`}>{n.tk}</div>
                  <div className="news-body">
                    <div className="news-headline">
                      {n.url
                        ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
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
            {ms.vwra && <span><span className="dot" style={{ background: 'var(--warn)' }} /> VWRA</span>}
          </div>
          {ms.perf && (
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em', margin: '2px 0 4px' }}>
              TWR {ms.perf.twrPct >= 0 ? '+' : ''}{ms.perf.twrPct.toFixed(1)}%
              {ms.perf.vwraPct != null && (
                <span style={{ color: ms.perf.twrPct - ms.perf.vwraPct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {' '}· {ms.perf.twrPct - ms.perf.vwraPct >= 0 ? 'BEATS' : 'TRAILS'} VWRA BY{' '}
                  {Math.abs(ms.perf.twrPct - ms.perf.vwraPct).toFixed(1)}pp
                </span>
              )}
            </div>
          )}
          {ms.risk && (
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em', margin: '0 0 4px' }}>
              maxDD {ms.risk.maxDDPct.toFixed(0)}% · vol {ms.risk.annVolPct.toFixed(0)}%
              {ms.risk.sharpe != null && <> · Sharpe {ms.risk.sharpe.toFixed(2)}</>}
            </div>
          )}
          <MacroChart nav={ms.nav} spx={ms.spx} vwra={ms.vwra} w={350} h={200} />
        </div>
      )}
    </div>
  );
}

// =============================================================
// SCOUT SCREEN — live from /api/dd/scouts
// =============================================================
function MobileScoreboard() {
  const [sb, setSb] = useState(window.SE_SEED?.scoreboard || null);
  const [wi, setWi] = useState(0);
  useEffect(() => {
    fetch('/api/dd/scoreboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && Array.isArray(d.windows)) setSb(d); })
      .catch(() => {});
  }, []);
  const windows = sb?.windows || [];
  const w = windows[Math.min(wi, Math.max(windows.length - 1, 0))];
  const o = w?.overall;
  const pct = (x, dec = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(dec) + '%';
  if (!sb || !w) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 12 }}>
        No scoreboard yet — lands with the next analyze run.
      </div>
    );
  }
  return (
    <div style={{ padding: 14 }}>
      <div className="m-tabs" style={{ padding: 0, marginBottom: 12, border: 'none' }}>
        {windows.map((win, i) => (
          <div key={win.weeks} className={`m-tab ${i === wi ? 'active' : ''}`} onClick={() => setWi(i)}>{win.weeks}W</div>
        ))}
      </div>
      {!o ? (
        <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 12 }}>
          Nothing measurable yet · {w.pending} pending
        </div>
      ) : (
        <>
          <div className="sb-hero" style={{ gap: 20 }}>
            <div>
              <div className="sb-big">{(o.hit * 100).toFixed(0)}%</div>
              <div className="sb-big-label">Hit rate</div>
            </div>
            <div>
              <div className={`sb-big ${o.mean >= 0 ? 'pos' : 'neg'}`}>{pct(o.mean)}</div>
              <div className="sb-big-label">Mean excess</div>
            </div>
            <div>
              <div className={`sb-big ${o.median >= 0 ? 'pos' : 'neg'}`}>{pct(o.median)}</div>
              <div className="sb-big-label">Median</div>
            </div>
          </div>
          <div className="sb-gauge-row">
            <span>Win</span>
            <GaugeBar value={o.hit} tone={o.hit >= 0.5 ? 'pos' : 'warn'} />
            <span>{o.n} of {w.measurable + w.pending + w.no_data}</span>
          </div>
          <div className="sb-chips">
            <span className="chip acc">{w.measurable} measured</span>
            <span className="chip">{w.pending} pending</span>
            {o.n < 10 && <span className="chip warn">⚠ small sample</span>}
          </div>
          {[['gate', 'Confirmation gate'], ['factors_v', 'Methodology version']].map(([key, label]) => {
            const rows = w.buckets?.[key];
            if (!rows || !rows.length) return null;
            return (
              <div className="sb-section" key={key}>
                <div className="dd-section-label">{label}</div>
                <table className="sb-table"><tbody>
                  {rows.map(r => (
                    <tr key={r.k}>
                      <td className="k">{r.k}</td>
                      <td className="n">n={r.n}</td>
                      <td className="v dim">{(r.hit * 100).toFixed(0)}%</td>
                      <td className={`v ${r.mean >= 0 ? 'pos' : 'neg'}`}>{pct(r.mean)}</td>
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
                {(w.top || []).slice(0, 3).map(t => (
                  <span className="sb-mover up" key={'t' + t.ticker}>▲ {t.ticker} {pct(t.excess)}</span>
                ))}
                {(w.bottom || []).slice(0, 3).map(t => (
                  <span className="sb-mover down" key={'b' + t.ticker}>▼ {t.ticker} {pct(t.excess)}</span>
                ))}
              </div>
            </div>
          ) : null}
          {w.score_ic && window.ScoreICSection && <window.ScoreICSection sic={w.score_ic} />}
          {sb.backtest && window.BacktestSection && <window.BacktestSection bt={sb.backtest} />}
          {window.AttributionHeatmap && <window.AttributionHeatmap sb={sb} />}
          {sb.holdings_analysis && window.AgentICSection && <window.AgentICSection ha={sb.holdings_analysis} weeks={w.weeks} />}
          {sb.behavior_gap?.paper && (
            <div className="sb-section">
              <div className="dd-section-label" title={sb.behavior_gap.note}>
                Signal vs behavior · since {sb.behavior_gap.since}
              </div>
              <div className="mono" style={{ fontSize: 11, lineHeight: 1.9 }}>
                Paper ({sb.behavior_gap.paper.n} CONFIRMs) {sb.behavior_gap.paper.mean_return_pct >= 0 ? '+' : ''}{sb.behavior_gap.paper.mean_return_pct?.toFixed(1)}%
                {' '}· VWRA {sb.behavior_gap.vwra_pct != null ? `${sb.behavior_gap.vwra_pct >= 0 ? '+' : ''}${sb.behavior_gap.vwra_pct.toFixed(1)}%` : '—'}
                {' '}· Real TWR {sb.behavior_gap.real_twr_pct != null ? `${sb.behavior_gap.real_twr_pct >= 0 ? '+' : ''}${sb.behavior_gap.real_twr_pct.toFixed(1)}%` : '—'}
              </div>
            </div>
          )}
          <div className="sb-note">
            excess vs {sb.benchmark} · {sb.n_signals} signals · updated {sb.generated_at ? _relDate(sb.generated_at) : '—'} ago
          </div>
        </>
      )}
    </div>
  );
}

function MobileScout({ onPick }) {
  const [scouts, setScouts] = useState(window.SCOUTS || []);
  const [src, setSrc] = useState((window.SCOUTS || []).length ? 'seed' : 'loading');
  const [mode, setMode] = useState('scouts'); // scouts | gems | review | perf

  useEffect(() => {
    if (mode === 'perf') { setSrc('live'); return; }
    setScouts([]);
    setSrc('loading');
    fetch(mode === 'gems' ? '/api/dd/gems' : mode === 'review' ? '/api/dd/watchlist' : '/api/dd/scouts')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length) {
          // Shared normalizer (dd-shared.jsx) — keeps the rich agent consensus
          // so a tapped card can show the real DD, identical to desktop.
          setScouts(d.map(window.normalizeScoutCard));
          setSrc('live');
        } else {
          setSrc('seed');
        }
      })
      .catch(() => setSrc('seed'));
  }, [mode]);

  const display = scouts.length ? scouts : (mode === 'scouts' ? (window.SCOUTS || []) : []);
  const nextRun = (() => {
    // scout.yml cron is "0 */4 * * *" — every 4h UTC (the old 06:00 ET label
    // was the portfolio schedule, not scout's).
    const next = new Date();
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 4 - (next.getUTCHours() % 4));
    const mins = Math.max(1, Math.round((next - Date.now()) / 60000));
    const hhmm = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `≈ ${hhmm} (in ${mins >= 60 ? Math.round(mins / 60) + 'h' : mins + 'm'})`;
  })();

  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="mscreen-title">{mode === 'gems' ? 'Gems' : mode === 'review' ? 'Under Review' : mode === 'perf' ? 'Performance' : 'Scout'}</div>
          <SrcPill src={src === 'loading' ? 'cached' : src} age={src === 'loading' ? '…' : 'now'} />
        </div>
        <div className="m-tabs" style={{ marginTop: 8 }}>
          {[['scouts', 'Scout'], ['gems', 'Gems'], ['review', 'Review'], ['perf', 'Perf']].map(([m, label]) => (
            <div key={m} className={`m-tab ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>{label}</div>
          ))}
        </div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 8, letterSpacing: '0.06em' }}>
          {mode === 'perf' ? 'signal forward returns vs VWRA'
            : `${display.length} ${mode === 'review' ? 'under review · failed confirmation gate' : 'tickers · screened on a schedule'}`}
        </div>
      </div>

      {mode === 'perf' ? (
        <MobileScoreboard />
      ) : !display.length ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-3)' }}>
          {mode === 'review' ? (
            <>
              <div className="mono uppercase" style={{ fontSize: 11, marginBottom: 8 }}>Nothing under review</div>
              <div style={{ fontSize: 12 }}>BUYs that fail the confirmation gate land here</div>
            </>
          ) : (
            <>
              <div className="mono uppercase" style={{ fontSize: 11, marginBottom: 8 }}>{mode === 'gems' ? 'Gems' : 'Scout'} is hunting</div>
              <div style={{ fontSize: 12 }}>Next run {nextRun}</div>
            </>
          )}
        </div>
      ) : (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {display.map((s, i) => {
            // v3 (2026-07-07): a red-team DOWNGRADE surfaces here flagged rather
            // than being suppressed to Under Review like a VETO.
            const flagged = mode !== 'review' && s.verdict === 'DOWNGRADE';
            return (
            <div key={s.tk + '-' + i}
              className={`scout-card ${mode === 'review' ? 'hold review' : (s.grade || '').toLowerCase().replace(' ','-')}${i === 0 ? ' featured' : ''}${flagged ? ' flagged' : ''}`}
              onClick={() => onPick && onPick(s)}
              title={`Open DD for ${s.tk}`}
              style={{ cursor: 'pointer' }}>
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
                {s.earningsInDays != null && <span className={`chip ${s.earningsInDays <= 5 ? 'warn' : 'dim'}`} title="Earnings report due — the analysis is priced pre-print; expect a volatility event before buying">ER {s.earningsInDays === 0 ? 'today' : `in ${s.earningsInDays}d`}</span>}
                {s.factors?.mom_12_1 != null && <span className="chip dim" title="12-1 momentum at signal time">mom {(s.factors.mom_12_1 * 100).toFixed(0)}%</span>}
                {s.factors?.quality != null && <span className="chip dim" title="Quality composite at signal time /10">q {(+s.factors.quality).toFixed(1)}</span>}
                {s.rr != null && <span className="chip rr" title="Computed reward-to-risk: upside vs conservative downside floor">R/R {(+s.rr).toFixed(1)}</span>}
                {(s.filters || []).map((f, j) => (
                  <span className={`chip ${j === (s.filters.length - 1) ? 'acc' : ''}`} key={f + '-' + j}>{f}</span>
                ))}
              </div>
              <div className="scout-meta"><span>{s.sector}</span><span>{s.ageDays != null && <span className={`card-age${s.ageDays > 7 ? ' stale' : ''}`} title={`Analyzed ${s.analyzedAt}`}>{s.ageDays === 0 ? 'today' : `${s.ageDays}d`} · </span>}Path {s.valPath}</span></div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================
// DETAIL / DD SCREEN — loads from KV, triggers real analysis
// =============================================================
function MobileDetail({ initialTicker }) {
  const [input, setInput] = useState(initialTicker || '');
  const [phase, setPhase] = useState('idle'); // idle | running | result
  const [result, setResult] = useState(null); // raw dd result object
  const [elapsed, setElapsed] = useState(0);
  const [ticker, setTicker] = useState(initialTicker || '');
  const [agentStates, setAgentStates] = useState({});
  const [log, setLog] = useState([]);
  const pollRef = useRef(null);
  const elapsedRef = useRef(null);
  const livePollRef = useRef(null);
  const liveCountRef = useRef(0);
  const logRef = useRef(null);

  const stopAll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (livePollRef.current) { clearInterval(livePollRef.current); livePollRef.current = null; }
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Read-only load of an existing dossier (used when launched with a ticker)
  const loadFromKV = useCallback(async (tk) => {
    try {
      const r = await fetch(`/api/dd/${tk.toUpperCase()}`);
      if (!r.ok) return;
      const data = await r.json();
      const d = data?.result || data;
      if (data && (d.consensus_score != null || d.score != null)) {
        setResult({ ...d, _dossier: data?.dossier || null }); // Evidence section
        setTicker(d.ticker || tk); setPhase('result');
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (initialTicker) { setInput(initialTicker); loadFromKV(initialTicker); }
  }, [initialTicker, loadFromKV]);

  const analyze = useCallback(async () => {
    const tk = input.trim().toUpperCase();
    if (!tk) return;
    stopAll();
    setTicker(tk);
    setPhase('running');
    setElapsed(0);
    setResult(null);
    setAgentStates({});
    setLog([{ who: 'SYSTEM', text: `[${tk}] Initializing 5-agent debate room.`, dim: true }]);
    liveCountRef.current = 0;

    const start = Date.now();
    elapsedRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try { await fetch('/api/dd/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: tk }) }); } catch {}

    const doPoll = async () => {
      try {
        const r = await fetch(`/api/dd/${tk.toUpperCase()}`);
        if (r.ok) {
          const data = await r.json();
          const d = data?.result || data;
          if (data && (d.consensus_score != null || d.score != null)) {
            stopAll();
            setResult({ ...d, _dossier: data?.dossier || null }); // Evidence section
            setPhase('result');
          }
        }
      } catch {}
    };
    setTimeout(() => { doPoll(); pollRef.current = setInterval(doPoll, 15_000); }, 5_000);

    // Live debate stream — real agent states + log lines from /api/dd/live
    const doLivePoll = async () => {
      try {
        const r = await fetch(`/api/dd/live/${tk.toLowerCase()}?after=${liveCountRef.current}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.events?.length) {
          liveCountRef.current += data.events.length;
          data.events.forEach(ev => {
            const agentId = ev.agent || ev.who || '';
            const designName = _AGENT_NAME_MAP[agentId] || agentId;
            const text = ev.text || ev.message || ev.content || '';
            if (ev.type === 'CONSENSUS' || ev.type === 'DOSSIER_START' || ev.type === 'START') {
              if (text) setLog(L => [...L, { who: 'SYSTEM', text, dim: true }].slice(-100));
            } else if (designName && _AGENT_KINDS[designName]) {
              if (text) setLog(L => [...L, { who: designName, text }].slice(-100));
              setAgentStates(s => ({ ...s, [designName]: 'thinking' }));
            } else if (ev.type === 'R3_DELTA' || ev.type === 'FETCH_DONE') {
              Object.keys(_AGENT_KINDS).forEach(n =>
                setAgentStates(s => ({ ...s, [n]: s[n] === 'thinking' ? 'done' : s[n] })));
            }
          });
          if (data.done) { clearInterval(livePollRef.current); livePollRef.current = null; doPoll(); }
        }
      } catch {}
    };
    livePollRef.current = setInterval(doLivePoll, 5_000);
  }, [input, stopAll]);

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
            {phase === 'running' ? `${_fmtElapsed(elapsed)}…` : 'Analyze'}
          </button>
        </div>
      </div>

      {phase === 'running' && (
        <div style={{ padding: 16 }}>
          <div className="debate-room">
            <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--acc)', letterSpacing: '0.14em', marginBottom: 8 }}>
              ▶ debate · {ticker}
            </div>
            <div className="debate-grid" style={{ gap: 6 }}>
              {_DESIGN_AGENTS.map(a => {
                const st = agentStates[a.name];
                return (
                  <div key={a.name} className={`agent ${st || ''}`}>
                    <AgentPixel kind={a.k} talking={st === 'thinking'} />
                    <div className="agent-name">{a.name}</div>
                    <div className="agent-status">{st === 'thinking' ? 'thinking…' : st === 'done' ? '✓' : 'waiting'}</div>
                  </div>
                );
              })}
            </div>
            <div ref={logRef} className="debate-log" style={{ maxHeight: 160, overflow: 'auto', marginTop: 10 }}>
              {log.map((l, i) => (
                <span key={i} className={`log-line ${l.dim ? 'dim' : ''}`}>
                  <span className={l.who === 'SYSTEM' ? 'you' : 'who'}>[{l.who}]</span> {l.text}
                </span>
              ))}
            </div>
            <div className="debate-progress" style={{ marginTop: 12 }}>
              <i style={{ width: `${Math.min(100, (elapsed / 600) * 100)}%` }} />
            </div>
            <div className="mono dim" style={{ fontSize: 10, textAlign: 'center', marginTop: 8 }}>
              elapsed {_fmtElapsed(elapsed)} · via GitHub Actions · 5–10 min
            </div>
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div style={{ padding: 16 }}>
          <DDResultFull data={result} />
        </div>
      )}

      {phase === 'idle' && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
            {_DESIGN_AGENTS.map(a => (
              <div key={a.k} style={{ opacity: 0.4 }}><AgentPixel kind={a.k} /></div>
            ))}
          </div>
          <div className="mono uppercase" style={{ fontSize: 11, color: 'var(--fg-2)' }}>5 agents standing by</div>
          <div style={{ marginTop: 8, fontSize: 12 }}>Enter a ticker and press Analyze to convene the debate.</div>
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
  const [health, setHealth] = useState(null);
  const fileRef = useRef(null);

  // Live API health (falls back to static window.API_HEALTH if the fetch fails)
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d) && d.length) setHealth(d); })
      .catch(() => {});
  }, []);

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

  async function parseFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type?.startsWith('image/')).slice(0, 6);
    if (!files.length) return;
    setStep('parse');
    setProgress(0);
    let prog = 0;
    const pt = setInterval(() => { prog = Math.min(prog + 5 + Math.random() * 6, 88); setProgress(prog); }, 180);
    try {
      const images = await Promise.all(files.map(f => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res({ imageData: fr.result.split(',')[1], mimeType: f.type || 'image/jpeg' });
        fr.onerror = rej;
        fr.readAsDataURL(f);
      })));
      const r = await fetch('/api/portfolio/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
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
        <p>Screenshot your broker app — add several if your list scrolls — and let Gemini extract your positions.</p>

        {step === 'idle' && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={e => parseFiles(e.target.files)} />
            <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 6 }}
              onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> Choose screenshot(s)
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
          {(health || window.API_HEALTH || []).map(api => {
            const pct = (api.quota && api.used != null) ? Math.min(100, (api.used / api.quota) * 100) : 0;
            const statusLabel = api.status === 'ok' ? '● OK'
              : api.status === 'degraded' ? '◐ DEGR'
              : api.status === 'unknown' || api.status === 'no-data' ? '○ N/A'
              : '✕ DOWN';
            return (
              <div key={api.id} className={`api-card ${api.status}`} style={{ padding: '10px 12px' }}>
                <div className="api-card-top">
                  <span className="api-card-name">{api.name}</span>
                  <span className={`api-card-status ${api.status}`}>{statusLabel}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                  <span>{api.scope}</span>
                  <span className="mono" style={{ fontSize: 10 }}>{api.latency > 0 ? api.latency + 'ms' : (api.lastOk || '')}</span>
                </div>
                {api.quota > 0 && api.used != null && (
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
// FIRE screen — the entire body (data, math, chart, form) is the shared
// dd-shared.FireBody; this is just the mobile chrome around it.
function MobileFire() {
  return (
    <div className="mobile-screen">
      <div className="mscreen-header">
        <div className="mscreen-title">FIRE</div>
        <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em', marginTop: 4 }}>
          Portfolio vs financial-independence number · SGD
        </div>
      </div>
      <div style={{ padding: 14 }}>
        <window.FireBody compact />
      </div>
    </div>
  );
}

function MobileApp() {
  const [screen, setScreen] = useState('portfolio');
  const { positions, setPositions, quotes } = useLiveData();
  const [ddModal, setDdModal] = useState(null); // { ticker, scout } | null

  // Reporting currency (USD/SGD) — mirrors desktop. Set window.__CCY in render so
  // child fmtMoney/fmtUSDC calls format with the current currency on this pass.
  const [currency, setCurrency] = useState((window.__CCY?.ccy) || 'USD');
  const [sgdRate, setSgdRate] = useState(window.CCY_RATES?.SGD || 1.35);
  useEffect(() => {
    fetch('/api/sgd-rate').then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.rate) setSgdRate(d.rate); }).catch(() => {});
  }, []);
  window.__CCY = {
    ccy: currency,
    rate: currency === 'SGD' ? sgdRate : 1,
    sym: currency === 'SGD' ? 'S$' : '$',
  };

  const openHolding = tk => setDdModal({ ticker: tk, scout: null });
  const openScout   = s  => setDdModal({ ticker: s.tk, scout: s });

  // FireBody (shared) reads portfolio value from this global — desktop's App
  // sets it, but mobile.html never loads app.jsx, so set it here too.
  useEffect(() => {
    try { window.__NLV = (window.computeTotals(positions, quotes) || {}).nlv || 0; } catch {}
  }, [positions, quotes]);

  // Swipe-to-delete on the holdings list — confirm, optimistic update, persist.
  const deletePosition = tk => {
    if (!window.confirm(`Remove ${tk} from your portfolio?`)) return;
    const next = positions.filter(p => p.ticker !== tk);
    setPositions(next);
    fetch('/api/positions', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  };

  // #dd/TICKER deep link — Telegram alert URLs land here on mobile.
  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.match(/^#dd\/([A-Z0-9.\-]{1,10})$/i);
      if (m) setDdModal({ ticker: m[1].toUpperCase(), scout: null });
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      {screen === 'portfolio' && <MobilePortfolio positions={positions} quotes={quotes} onPick={openHolding} currency={currency} onToggleCurrency={setCurrency} onDelete={deletePosition} />}
      {screen === 'intel'     && <MobileIntel />}
      {screen === 'scout'     && <MobileScout onPick={openScout} />}
      {screen === 'fire'      && <MobileFire />}
      {screen === 'detail'    && <MobileDetail />}
      {screen === 'settings'  && <MobileSettings positions={positions} setPositions={setPositions} />}
      <MobileTabbar active={screen} onChange={setScreen} />
      {ddModal && <MobileDDModal ticker={ddModal.ticker} fallbackScout={ddModal.scout} onClose={() => setDdModal(null)} />}
    </>
  );
}

window.MobileFrame = MobileFrame;
window.MobileApp = MobileApp;

// mobile.html renders standalone — wrap in the .mobile-shell grid (statusbar /
// scrollable screen / tabbar) the layout depends on. Without this the three
// regions render side-by-side (flex row) and the page is unusable.
if (document.getElementById('root') && !window.__DESKTOP_BOOT__) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <div className="mobile-shell mobile-shell-standalone">
      <MobileApp />
    </div>
  );
}
})();
