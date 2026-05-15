// Sovereign Eye — Middle row: Intelligence Feed, News, Macro Chart

const { useState: useS2, useMemo: useM2, useEffect: useE2, useRef: useR2 } = React;

// ── Helpers ────────────────────────────────────────────────────────────────

// Escape HTML then re-allow only safe inline tags (<b>, <strong>, <em>, <i>).
// Prevents XSS from LLM-generated content rendered as inner HTML.
function sanitizeInlineHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?(?:b|strong|em|i))&gt;/g, "<$1>");
}

// ── Intelligence Feed ──────────────────────────────────────────────────────

function IntelligenceFeed({ tickers }) {
  const [tab, setTab] = useS2("catalysts");
  const [data, setData] = useS2(null);      // live synthesis result
  const [status, setStatus] = useS2("loading"); // "loading" | "live" | "cached" | "seed"

  useE2(() => {
    if (!tickers || !tickers.length) { setStatus("seed"); return; }
    const qs = tickers.join(",");
    fetch(`/api/synthesis?tickers=${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && (d.catalysts || d.risks || d.macro)) {
          setData(d);
          setStatus(d.cached ? "cached" : "live");
        } else {
          setStatus("seed");
        }
      })
      .catch(() => setStatus("seed"));
  }, [tickers?.join(",")]);

  // Normalise API or seed bullets to display objects
  const items = useM2(() => {
    const tagMap = { catalysts: "pos", risks: "warn", macro: "info" };
    const tagClass = tagMap[tab] || "info";

    if (data && data[tab]) {
      return data[tab].map((text, i) => ({
        tag: tab === "catalysts" ? "CATALYST" : tab === "risks" ? "RISK" : "MACRO",
        tagClass,
        text: typeof text === "string" ? text : text.text || "",
      }));
    }
    // Fallback to seed
    return (window.SE_SEED.intel[tab] || []);
  }, [data, tab]);

  const badgeLabel = status === "live" ? "LIVE" : status === "cached" ? "CACHED" : "SEED";
  const badgeCls = status === "live" ? "badge-live" : status === "cached" ? "badge-cached" : "badge-cached";

  return (
    <Panel idx="03" title="Intelligence Feed"
      headRight={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={"badge " + badgeCls}>GEMMA · {badgeLabel}</span>
          <div className="tabs">
            <div className={"tab" + (tab === "catalysts" ? " active" : "")} onClick={() => setTab("catalysts")}>Catalysts</div>
            <div className={"tab" + (tab === "risks"     ? " active" : "")} onClick={() => setTab("risks")}>Risks</div>
            <div className={"tab" + (tab === "macro"     ? " active" : "")} onClick={() => setTab("macro")}>Macro</div>
          </div>
        </div>
      }>
      <div className="intel-list">
        {status === "loading" ? (
          [1,2,3].map(i => (
            <div className="intel-item" key={i}>
              <div className="num">0{i}</div>
              <div className="body" style={{ width: "100%" }}>
                <div className="shimmer" style={{ width: "90%", marginBottom: 4 }}></div>
                <div className="shimmer" style={{ width: "70%" }}></div>
              </div>
            </div>
          ))
        ) : items.map((it, i) => (
          <div className="intel-item" key={i}>
            <div className="num">0{i + 1}</div>
            <div className="body">
              <span className={"tag " + (it.tagClass || "")}>{it.tag}</span>
              <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(it.text) }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── News ───────────────────────────────────────────────────────────────────

function News({ tickers }) {
  const [tab, setTab] = useS2("portfolio");
  const [portfolioNews, setPortfolioNews] = useS2(null);
  const [wireNews, setWireNews] = useS2(null);
  const [portStatus, setPortStatus] = useS2("loading");
  const [wireStatus, setWireStatus] = useS2("loading");

  const tkStr = (tickers || []).join(",");

  useE2(() => {
    if (!tkStr) { setPortStatus("seed"); setWireStatus("seed"); return; }

    // Portfolio news
    fetch(`/api/news?tickers=${tkStr}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length > 0) {
          setPortfolioNews(d.map(n => ({
            tk: n.ticker || "—",
            sev: n.severity || "info",
            headline: n.headline,
            src: n.source || "—",
            when: n.ago || "?",
            url: n.url || null,
          })));
          setPortStatus("live");
        } else {
          setPortStatus("seed");
        }
      })
      .catch(() => setPortStatus("seed"));

    // Wire news
    fetch(`/api/wire?tickers=${tkStr}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length > 0) {
          setWireNews(d.map(n => ({
            tk: n.ticker_or_sector || n.ticker || "MACRO",
            sev: n.severity || "info",
            headline: n.headline,
            src: n.source || "—",
            when: n.ago || "?",
            url: n.url || null,
          })));
          setWireStatus("live");
        } else {
          setWireStatus("seed");
        }
      })
      .catch(() => setWireStatus("seed"));
  }, [tkStr]);

  const currentStatus = tab === "portfolio" ? portStatus : wireStatus;
  const badgeCls = currentStatus === "live" ? "badge-live" : "badge-cached";
  const badgeLabel = currentStatus === "live" ? "LIVE" : currentStatus === "loading" ? "LOADING" : "SEED";

  const items = tab === "portfolio"
    ? (portfolioNews || window.SE_SEED.portfolioNews)
    : (wireNews || window.SE_SEED.newsWire);

  const isLoading = currentStatus === "loading";

  return (
    <Panel idx="04" title="News"
      headRight={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={"badge " + badgeCls}>{badgeLabel}</span>
          <div className="tabs">
            <div className={"tab" + (tab === "portfolio" ? " active" : "")} onClick={() => setTab("portfolio")}>Portfolio</div>
            <div className={"tab" + (tab === "wire"      ? " active" : "")} onClick={() => setTab("wire")}>News Wire</div>
          </div>
        </div>
      }>
      <div className="news-list">
        {isLoading ? (
          [1,2,3,4].map(i => (
            <div className="news-item info" key={i}>
              <div><span className="news-tk" style={{ opacity: 0.3 }}>····</span></div>
              <div><div className="shimmer" style={{ width: "80%", marginBottom: 3 }}></div><div className="shimmer" style={{ width: "55%" }}></div></div>
              <div className="news-meta" style={{ opacity: 0.3 }}>—</div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="news-empty">NO ITEMS · CHECK BACK SHORTLY</div>
        ) : items.map((n, i) => (
          <div className={"news-item " + (n.sev || "")} key={i}>
            <div><span className="news-tk">{n.tk}</span></div>
            <div className={"news-headline" + (n.sev === "warn" ? " warn" : "")}>
              <span className={"sent-pill sent-" + (n.sev === "warn" ? "bear" : "bull")}>
                {n.sev === "warn" ? "BEAR" : "BULL"}
              </span>
              {n.url
                ? <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}
                     onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                     onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}>{n.headline}</a>
                : n.headline}
            </div>
            <div className="news-meta"><b>{n.src}</b> · {n.when}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── MacroChart ─────────────────────────────────────────────────────────────

function MacroChart() {
  const { months, portfolio, spx } = window.SE_SEED.macroSeries;
  const wrapRef = useR2(null);
  const [dim, setDim] = useS2({ w: 480, h: 220 });

  useE2(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const b = el.getBoundingClientRect();
      setDim({ w: b.width, h: b.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { mainPath, spxPath, spreadPath, xs, mainBand, spreadBand, gridY, lastP, lastS, lastSpread } = useM2(() => {
    const padL = 36, padR = 12, padT = 8, padB = 26;
    const splitY = dim.h * 0.66;
    const mainH = splitY - padT;
    const spreadH = dim.h - splitY - padB;

    const allMain = [...portfolio, ...spx];
    const mn = Math.min(...allMain), mx = Math.max(...allMain);
    const pad = (mx - mn) * 0.08;
    const lo = mn - pad, hi = mx + pad;

    const spread = portfolio.map((p, i) => p - spx[i]);
    const sMn = Math.min(...spread), sMx = Math.max(...spread);
    const sPad = (sMx - sMn) * 0.2 || 1;
    const sLo = sMn - sPad, sHi = sMx + sPad;

    const x = i => padL + (dim.w - padL - padR) * (i / (months.length - 1));
    const y1 = v => padT + mainH * (1 - (v - lo) / (hi - lo));
    const y2 = v => splitY + 6 + spreadH * (1 - (v - sLo) / (sHi - sLo));

    const toPath = (arr, ymap) =>
      arr.map((v, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + ymap(v).toFixed(1)).join(" ");

    const xs = months.map((m, i) => ({ x: x(i), label: m }));
    const gridY = [];
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * (k / 3);
      gridY.push({ y: y1(v), v: v.toFixed(0) });
    }

    return {
      mainPath: toPath(portfolio, y1), spxPath: toPath(spx, y1), spreadPath: toPath(spread, y2),
      xs, mainBand: { padL, padR, padT, mainH, splitY }, spreadBand: { splitY, spreadH },
      gridY, lastP: portfolio[portfolio.length - 1], lastS: spx[spx.length - 1],
      lastSpread: spread[spread.length - 1]
    };
  }, [dim, months, portfolio, spx]);

  return (
    <Panel idx="05" title="Macro Correlation" meta={<span>Portfolio · SPX · 14M</span>}>
      <div className="chart-wrap">
        <div className="chart-legend">
          <span><span className="swatch" style={{ background: "var(--acc)" }}></span>Portfolio <b>{lastP.toFixed(1)}</b></span>
          <span><span className="swatch" style={{ background: "var(--info)" }}></span>SPX <b>{lastS.toFixed(1)}</b></span>
          <span><span className="swatch" style={{ background: "var(--fg-3)" }}></span>Spread <b>{lastSpread >= 0 ? "+" : ""}{lastSpread.toFixed(1)}</b></span>
        </div>
        <div style={{ flex: 1, minHeight: 80 }} ref={wrapRef}>
          <svg className="chart-svg" viewBox={`0 0 ${dim.w} ${dim.h}`} preserveAspectRatio="none">
            {gridY.map((g, i) => (
              <g key={i}>
                <line x1={mainBand.padL} x2={dim.w - mainBand.padR} y1={g.y} y2={g.y} stroke="#1f1f25" strokeDasharray="1 4" />
                <text x={mainBand.padL - 6} y={g.y + 3} textAnchor="end" fontFamily="JetBrains Mono" fontSize="9" fill="#52525b">{g.v}</text>
              </g>
            ))}
            <line x1={mainBand.padL} x2={dim.w - mainBand.padR} y1={mainBand.splitY} y2={mainBand.splitY} stroke="#27272e" />
            {xs.map((t, i) => i % 2 === 0 && (
              <text key={i} x={t.x} y={dim.h - 8} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#52525b">{t.label}</text>
            ))}
            <path d={spxPath}  fill="none" stroke="var(--info)" strokeWidth="1.2" />
            <path d={mainPath} fill="none" stroke="var(--acc)"  strokeWidth="1.5" />
            <path d={spreadPath} fill="none" stroke="var(--fg-3)" strokeWidth="1" />
            <path d={spreadPath + ` L ${dim.w - mainBand.padR} ${mainBand.splitY + 6 + spreadBand.spreadH} L ${mainBand.padL} ${mainBand.splitY + 6 + spreadBand.spreadH} Z`}
                  fill="rgba(113,113,122,0.08)" stroke="none" />
            <text x={mainBand.padL + 4} y={mainBand.splitY + 18} fontFamily="JetBrains Mono" fontSize="9" fill="#52525b" letterSpacing="0.1em">SPREAD (PORT − SPX)</text>
          </svg>
        </div>
        <div className="chart-stats">
          <div className="stat"><span className="k">14m Return</span><span className="v" style={{ color: "var(--pos)" }}>+{(lastP - 100).toFixed(1)}%</span></div>
          <div className="stat"><span className="k">vs SPX</span><span className="v" style={{ color: "var(--pos)" }}>+{(lastP - lastS).toFixed(1)}%</span></div>
          <div className="stat"><span className="k">Beta</span><span className="v">1.12</span></div>
          <div className="stat"><span className="k">Corr (90d)</span><span className="v">0.86</span></div>
        </div>
      </div>
    </Panel>
  );
}

Object.assign(window, { IntelligenceFeed, News, MacroChart });
