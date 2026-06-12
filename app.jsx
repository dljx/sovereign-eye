/* global React, ReactDOM, window, Icon, SrcPill,
   HoldingsPanel, HeatmapPanel, IntelPanel, NewsPanel, MacroPanel,
   FilingsPanel, DDPanel, ScoutPanel, ApiHealthPanel, ScoutDDModal, HoldingDDModal,
   ImportModal, MobileFrame, MobileApp,
   computeTotals, fmtUSD, fmtUSDC, fmtMoney, fmtPct, sign, normQ,
   TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakColor, TweakToggle */
(function () {
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const BUILD = '20260528-5';

// =============================================================
// TIMEZONE / MARKET SESSION
// =============================================================
const TZ_MARKET = 'America/New_York';
const TZ_SGT    = 'Asia/Singapore';

function _nowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ_MARKET }));
}

function getMarketSession() {
  const et = _nowET();
  const day = et.getDay();
  if (day === 0 || day === 6) return 'CLOSED';
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins <  240) return 'CLOSED';
  if (mins <  570) return 'PRE-MKT';
  if (mins <  960) return 'OPEN';
  if (mins < 1200) return 'AFTER-HRS';
  return 'CLOSED';
}

function getRefreshMs(session) {
  if (session === 'OPEN' || session === 'PRE-MKT' || session === 'AFTER-HRS') return 30_000;
  return 5 * 60_000;
}

// =============================================================
// SGD RATE HOOK
// =============================================================
function useSGD() {
  const [rate, setRate] = useState(() => {
    const stored = parseFloat(localStorage.getItem('sgd_rate') || '');
    return isFinite(stored) && stored > 0 ? stored : 1.35;
  });
  useEffect(() => {
    fetch('/api/sgd-rate')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.rate) {
          setRate(d.rate);
          localStorage.setItem('sgd_rate', String(d.rate));
        }
      })
      .catch(() => {});
  }, []);
  return rate;
}

// =============================================================
// QUOTES HOOK (Finnhub, normalized to {px, dPct, dAbs, vol})
// =============================================================
function useQuotes(positions) {
  const [quotes, setQuotes] = useState(() => {
    const q = {};
    const seedQ = window.SE_CONFIG?.SEED_QUOTES || {};
    for (const p of positions) {
      const sq = seedQ[p.ticker];
      q[p.ticker] = sq
        ? { ...normQ(sq), pe: sq.pe, eps: sq.eps, tgt: sq.target ?? sq.tgt }
        : { px: p.avg || 0, dPct: 0, dAbs: 0, vol: 0 };
    }
    return q;
  });
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [quoteSrc, setQuoteSrc] = useState('loading');
  const [session, setSession] = useState(getMarketSession);
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const sess = getMarketSession();
    setSession(sess);
    const tickers = positions.map(p => p.ticker).filter(t => t && t !== 'USD');
    if (!tickers.length) return;

    try {
      let quotesMap = null;
      const proxyRes = await fetch(`/api/quotes?tickers=${tickers.join(',')}`).catch(() => null);
      if (proxyRes?.ok) {
        quotesMap = await proxyRes.json();
      } else {
        const apiKey = window.SE_CONFIG?.CONFIG?.FINNHUB_API_KEY;
        if (apiKey) {
          const results = await Promise.all(
            tickers.map(t =>
              fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${apiKey}`)
                .then(r => r.ok ? r.json() : null).catch(() => null)
            )
          );
          quotesMap = {};
          tickers.forEach((t, i) => { if (results[i]?.c > 0) quotesMap[t] = results[i]; });
        }
      }

      if (quotesMap && Object.keys(quotesMap).length) {
        setQuotes(prev => {
          const next = { ...prev };
          tickers.forEach(t => {
            const r = quotesMap[t];
            if (r && (r.c > 0 || r.px > 0)) {
              const seed = prev[t] || {};
              next[t] = {
                ...normQ(r),
                pe: r.pe ?? seed.pe,
                eps: r.eps ?? seed.eps,
                tgt: r.target ?? r.tgt ?? seed.tgt,
              };
            }
          });
          return next;
        });
        setLastRefresh(new Date());
        setQuoteSrc('live');
      }
    } catch {
      setQuoteSrc('cached');
    }

    const nextMs = getRefreshMs(sess);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAll, nextMs);
  }, [positions]);

  useEffect(() => {
    fetchAll();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  return { quotes, lastRefresh, quoteSrc, session, refresh: fetchAll };
}

// =============================================================
// TWEAK DEFAULTS
// =============================================================
const TWEAK_DEFAULTS = {
  density: 'compact',
  accent: '#a78bfa',
  scanlines: false,
  glow: false,
  showMobile: false,
  currency: 'USD',
};

// =============================================================
// COLOR HELPER
// =============================================================
function mix(a, b, w) {
  const parse = h => [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  const ah = (a.startsWith('#') ? a.slice(1) : a).padStart(6, '0');
  const bh = (b.startsWith('#') ? b.slice(1) : b).padStart(6, '0');
  const [ar,ag,ab] = parse(ah), [br,bg,bb] = parse(bh);
  const r = Math.round(ar*(1-w)+br*w), g = Math.round(ag*(1-w)+bg*w), bl = Math.round(ab*(1-w)+bb*w);
  return '#' + [r,g,bl].map(v => v.toString(16).padStart(2,'0')).join('');
}

// =============================================================
// HEADER
// =============================================================
const NAV_ITEMS = [
  { id: 'dash',     icon: 'dashboard', label: 'Dashboard' },
  { id: 'research', icon: 'research',  label: 'Research' },
  { id: 'system',   icon: 'activity',  label: 'System' },
];

function Header({ totals, onImport, onToggleMobile, mobileOpen, route, onRoute, currency, onToggleCurrency }) {
  return (
    <div className="header">
      <div className="brand">
        <span className="brand-mark" />
        <span>SOVEREIGN&nbsp;EYE</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--fg-4)', letterSpacing: '0.16em', marginLeft: 6 }}>v3</span>
      </div>

      <div className="header-nav">
        {NAV_ITEMS.map(it => (
          <div key={it.id} className={`nav-item ${route === it.id ? 'active' : ''}`}
            onClick={() => onRoute(it.id)} title={it.label}>
            <Icon name={it.icon} size={14} />
            <span>{it.label}</span>
          </div>
        ))}
      </div>

      <div className="header-stats">
        <div className="h-stat">
          <div className="h-stat-label">NLV</div>
          <div className="h-stat-value tabular">{fmtMoney(totals.nlv)}</div>
        </div>
        <div className="h-stat">
          <div className="h-stat-label">Day P&L</div>
          <div className={`h-stat-value tabular ${sign(totals.dayPnl)}`}>
            {totals.dayPnl >= 0 ? '+' : ''}{fmtUSDC(totals.dayPnl)} {fmtPct(totals.dayPnlPct)}
          </div>
        </div>
      </div>

      <div className="header-spacer" />

      <div className="header-search" title="Ticker search — coming soon" style={{ opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' }}>
        <Icon name="search" size={13} />
        <input placeholder="symbol or command…" readOnly tabIndex={-1} />
        <span className="header-search-kbd">⌘K</span>
      </div>

      <div className="ccy-toggle" title="Toggle reporting currency">
        {['USD','SGD'].map(c => (
          <button key={c} className={`ccy-btn ${currency === c ? 'active' : ''}`}
            onClick={() => onToggleCurrency(c)}>{c}</button>
        ))}
      </div>

      <button className="btn" onClick={onImport} title="Import portfolio from screenshot">
        <Icon name="upload" size={12} /> Import
      </button>
      <button className="btn-icon" title="Notifications — coming soon" disabled style={{ opacity: 0.4 }}><Icon name="bell" size={14} /></button>
      <button
        className="btn-icon"
        onClick={onToggleMobile}
        title="Toggle mobile preview"
        style={mobileOpen ? { color: 'var(--acc)', borderColor: 'var(--acc)' } : null}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="6" y="2" width="12" height="20" rx="2" /><line x1="11" y1="18" x2="13" y2="18" />
        </svg>
      </button>
      <button className="btn-icon" title="Settings"><Icon name="settings" size={14} /></button>
    </div>
  );
}

// =============================================================
// STATUS BAR
// =============================================================
function StatusBar({ session, lastRefresh, quoteSrc, sgdRate, hovered, totals }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const sessionClass = { OPEN: 'pos', 'PRE-MKT': 'warn', 'AFTER-HRS': 'warn', CLOSED: 'dim' }[session] || 'dim';
  const nextMs = getRefreshMs(session);
  const sinceMs = Date.now() - lastRefresh.getTime();
  const remaining = Math.max(0, Math.ceil((nextMs - sinceMs) / 1000));
  const clock = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: TZ_SGT });

  return (
    <div className="status">
      <div className="status-item">
        <span className={`dot ${sessionClass}`} /> SESSION · <span className={sessionClass}>{session}</span>
      </div>
      <div className="status-divider" />
      <div className="status-item">QUOTE SRC · <span className={quoteSrc === 'live' ? 'pos' : 'warn'}>{quoteSrc}</span></div>
      <div className="status-divider" />
      <div className="status-item">REFRESH · {remaining}s</div>
      <div className="status-divider" />
      <div className="status-item">USD/SGD · {sgdRate.toFixed(4)}</div>
      <div className="status-spacer" />
      {hovered ? (
        <>
          <div className="status-item">
            <span style={{ color: 'var(--acc)' }}>{hovered.ticker}</span>
            {' · '}{hovered.name}
            {' · '}<span className={sign(hovered.dPct || 0)}>{((hovered.dPct || 0) >= 0 ? '+' : '') + (hovered.dPct || 0).toFixed(2)}%</span>
            {' · '}qty {hovered.qty} @ {fmtMoney(hovered.avg, 2)}
            {' · '}mv {fmtMoney((hovered.px || 0) * hovered.qty)}
          </div>
          <div className="status-divider" />
        </>
      ) : null}
      <div className="status-item">{clock} SGT</div>
      <div className="status-divider" />
      <div className="status-item" style={{ color: 'var(--fg-4)', letterSpacing: '0.06em' }}>BUILD · {BUILD}</div>
    </div>
  );
}

// =============================================================
// TAB VIEWS
// =============================================================
function DashView({ positions, quotes, totals, onHoverPosition, hoveredTk }) {
  const [sortKey, setSortKey] = useState('mv');
  const [sortDir, setSortDir] = useState('desc');
  const [ddTicker, setDdTicker] = useState(null);

  function onSort(k) {
    setSortKey(prev => {
      if (prev === k) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return k; }
      setSortDir('desc'); return k;
    });
  }

  return (
    <div className="dash dash-overview">
      <div className="panel" style={{ gridArea: 'holdings' }}>
        <div className="panel-header">
          <div className="panel-title">
            <span className="num">01</span> Holdings Inventory
          </div>
          <div className="panel-actions">
            <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
              {positions.length} POS · {fmtMoney(totals.nlv)} NLV
            </span>
            <SrcPill src="live" age="now" />
          </div>
        </div>
        <div className="panel-body flush" style={{ overflow: 'auto', maxHeight: 420 }}>
          <HoldingsPanel
            positions={positions}
            quotes={quotes}
            totals={totals}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            onHover={onHoverPosition}
            onLeave={() => onHoverPosition(null)}
            hoveredTk={hoveredTk}
            onRowClick={setDdTicker}
          />
        </div>
      </div>

      <div className="panel" style={{ gridArea: 'heatmap' }}>
        <div className="panel-header">
          <div className="panel-title"><span className="num">02</span> Holdings Heatmap</div>
          <div className="panel-actions">
            <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>BY DAY %</span>
            <SrcPill src="live" age="now" />
          </div>
        </div>
        <div className="panel-body flush">
          <HeatmapPanel positions={positions} quotes={quotes} totals={totals} />
        </div>
      </div>

      <div className="panel" style={{ gridArea: 'intel' }}><IntelPanel /></div>
      <div className="panel panel-news" style={{ gridArea: 'news' }}><NewsPanel /></div>
      <div className="panel" style={{ gridArea: 'filings' }}><FilingsPanel /></div>
      <div className="panel" style={{ gridArea: 'macro' }}><MacroPanel /></div>
      {ddTicker && <HoldingDDModal ticker={ddTicker} onClose={() => setDdTicker(null)} />}
    </div>
  );
}

function ResearchView({ onPickScout }) {
  return (
    <div className="dash dash-research" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel"><DDPanel /></div>
      <div className="panel"><ScoutPanel onPick={onPickScout} /></div>
    </div>
  );
}

function SystemView() {
  return (
    <div className="dash dash-system" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel"><ApiHealthPanel /></div>
    </div>
  );
}

// =============================================================
// MOBILE PREVIEW PANE
// =============================================================
function MobilePreviewPane({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', top: 56, right: 0, bottom: 28, left: 'auto', width: 460,
      background: 'var(--bg-1)', borderLeft: '1px solid var(--border-2)',
      zIndex: 60, display: 'flex', flexDirection: 'column',
      boxShadow: '-12px 0 40px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-1)' }}>
        <div className="mono uppercase" style={{ fontSize: 10, color: 'var(--fg-2)', letterSpacing: '0.16em' }}>
          Mobile preview · 390×844
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn-icon" onClick={onClose}><Icon name="close" size={13} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <MobileFrame label="390 × 844">
          <MobileApp />
        </MobileFrame>
      </div>
    </div>
  );
}

// =============================================================
// ROOT APP
// =============================================================
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useState('dash');
  const [importOpen, setImportOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [scoutPick, setScoutPick] = useState(null);
  const [currency, setCurrency] = useState(t.currency || 'USD');

  // Positions — seed from positions.js, then overwrite from KV
  const [positions, setPositions] = useState(() =>
    (window.SE_CONFIG?.MY_POSITIONS || []).map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 }))
  );

  useEffect(() => {
    fetch('/api/positions')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length) {
          const mapped = data.map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 }));
          window.POSITIONS = mapped;
          setPositions(mapped);
          window.dispatchEvent(new Event('se:positions'));

          // Fetch real sparklines and push into SPARKS proxy
          const tks = mapped.map(p => p.ticker).filter(t => t && t !== 'USD').join(',');
          if (tks) {
            fetch(`/api/sparks?tickers=${tks}`)
              .then(r => r.ok ? r.json() : null)
              .then(sparks => {
                if (sparks && typeof sparks === 'object') {
                  Object.assign(window.SPARKS, sparks);
                  window.dispatchEvent(new Event('se:sparks'));
                }
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const { quotes, lastRefresh, quoteSrc, session } = useQuotes(positions);
  const sgdRate = useSGD();

  // Keep globals up-to-date so panels reading them directly stay current
  useEffect(() => {
    window.QUOTES = quotes;
    window.POSITIONS = positions;
  }, [quotes, positions]);

  const totals = useMemo(() => window.computeTotals(positions, quotes), [positions, quotes]);

  // Currency → global CCY context for formatters
  useEffect(() => {
    const CCY_RATES = window.CCY_RATES || { USD: 1, SGD: sgdRate };
    CCY_RATES.SGD = sgdRate;
    window.__CCY = {
      ccy: currency,
      rate: CCY_RATES[currency] || 1,
      sym: currency === 'SGD' ? 'S$' : '$',
    };
    setTweak('currency', currency);
  }, [currency, sgdRate]);

  // Apply tweaks to CSS custom props
  useEffect(() => {
    document.documentElement.style.setProperty('--acc', t.accent);
    document.documentElement.style.setProperty('--acc-2', mix(t.accent, '#ffffff', 0.3));
    document.documentElement.style.setProperty('--acc-dim', t.accent + '22');
    document.documentElement.style.setProperty('--acc-glow', t.accent + '55');
    document.documentElement.setAttribute('data-density', t.density);
  }, [t.accent, t.density]);

  const bodyClass = [t.scanlines && 'scanlines', t.glow && 'glow'].filter(Boolean).join(' ');
  const hoveredTk = hovered?.ticker || null;

  return (
    <div className={`app ${bodyClass}`} data-screen-label="Sovereign Eye · Desktop">
      <Header
        totals={totals}
        onImport={() => setImportOpen(true)}
        onToggleMobile={() => setMobileOpen(v => !v)}
        mobileOpen={mobileOpen}
        route={route}
        onRoute={setRoute}
        currency={currency}
        onToggleCurrency={setCurrency}
      />

      <div className="main">
        {route === 'dash' && (
          <DashView
            positions={positions}
            quotes={quotes}
            totals={totals}
            onHoverPosition={setHovered}
            hoveredTk={hoveredTk}
          />
        )}
        {route === 'research' && <ResearchView onPickScout={s => setScoutPick(s)} />}
        {route === 'system'   && <SystemView />}
      </div>

      <StatusBar
        session={session}
        lastRefresh={lastRefresh}
        quoteSrc={quoteSrc}
        sgdRate={sgdRate}
        hovered={hovered}
        totals={totals}
      />

      <ImportModal
        open={importOpen}
        positions={positions}
        onClose={() => setImportOpen(false)}
        onSave={newPos => {
          setPositions(newPos);
          setImportOpen(false);
        }}
      />

      <MobilePreviewPane open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <ScoutDDModal scout={scoutPick} onClose={() => setScoutPick(null)} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Display" />
        <TweakRadio
          label="Density"
          value={t.density}
          options={['compact','comfortable']}
          onChange={v => setTweak('density', v)}
        />
        <TweakColor
          label="Accent"
          value={t.accent}
          options={['#a78bfa','#60a5fa','#fbbf24','#4ade80','#f87171']}
          onChange={v => setTweak('accent', v)}
        />
        <TweakToggle label="Scanlines" value={t.scanlines} onChange={v => setTweak('scanlines', v)} />
        <TweakToggle label="Number glow" value={t.glow} onChange={v => setTweak('glow', v)} />
        <TweakSection label="Preview" />
        <TweakToggle label="Mobile pane" value={mobileOpen} onChange={() => setMobileOpen(v => !v)} />
        <TweakSection label="Actions" />
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setImportOpen(true)}>
          Open import flow
        </button>
      </TweaksPanel>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[sovereign-eye] render error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '48px 32px', fontFamily: 'var(--mono, monospace)', color: 'var(--neg, #e05)', textAlign: 'center', background: 'var(--bg, #0d0d0d)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.1em' }}>RENDER ERROR</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3, #555)', maxWidth: 480 }}>{this.state.error.message}</div>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: '6px 16px', fontSize: 11, fontFamily: 'inherit', background: 'transparent', border: '1px solid var(--border, #333)', color: 'var(--fg, #ccc)', cursor: 'pointer', letterSpacing: '0.08em' }}>RETRY</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
})();
