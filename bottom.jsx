// Sovereign Eye — Bottom row: SEC Tracker, Sovereign DD, Sovereign Scout

const { useState: useS3, useEffect: useE3, useRef: useR3, useMemo: useM3, useCallback: useC3 } = React;

const MEANINGFUL_FORMS = new Set(["8-K", "10-Q", "10-K", "S-1", "DEF 14A", "6-K", "10-K/A", "8-K/A"]);

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtElapsed(secs) {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

// Map sovereign-dd result shape → display shape
function mapDDResult(data) {
  if (!data) return null;
  const score = data.consensus_score ?? data.score ?? 0;
  const rawGrade = (data.consensus_grade ?? data.grade ?? "HOLD").trim();
  const grade = rawGrade.replace(/ /g, "-").toUpperCase();
  const confidence = data.confidence ?? "MEDIUM";
  const thesis = data.majority_thesis ?? data.thesis ?? "";
  const swing = data.key_swing_factor ?? data.swing ?? "";
  const agents = (data.agents || []).map(a => {
    const rawVote = (a.signal ?? a.vote ?? a.stance ?? "HOLD").toUpperCase();
    const vote = (rawVote === "BUY" || rawVote === "STRONG BUY" || rawVote === "STRONG-BUY" || rawVote === "BULL")
      ? "bull"
      : (rawVote === "SELL" || rawVote === "BEAR")
        ? "bear"
        : "neut";
    return {
      name: a.role ?? a.agent ?? a.name ?? "Agent",
      vote,
      text: a.rationale ?? a.note ?? a.commentary ?? a.text ?? ""
    };
  });
  return { score, grade, confidence, thesis, swing, agents };
}

// ── SEC Tracker ────────────────────────────────────────────────────────────

function SECTracker({ tickers }) {
  const [filings, setFilings] = useS3(null);
  const [status, setStatus] = useS3("loading");

  // TL;DR + sentiment lookup from seed SEC_SEED (by ticker)
  const seedMap = useM3(() => {
    const m = {};
    const seed = window.SE_CONFIG?.SEC_SEED || window.SE_SEED?.secFilings || [];
    for (const f of seed) {
      const tk = f.ticker || f.tk;
      if (!m[tk]) m[tk] = { tldr: f.tldr || f.summary || "", sentiment: f.sentiment || null };
    }
    return m;
  }, []);

  useE3(() => {
    if (!tickers?.length) { setStatus("seed"); return; }

    const apiKey = window.SE_CONFIG?.CONFIG?.FINNHUB_API_KEY;
    if (!apiKey) { setStatus("seed"); return; }

    // Fetch filings for each ticker in parallel, take most recent per ticker
    Promise.all(
      tickers.slice(0, 8).map(t =>
        fetch(`https://finnhub.io/api/v1/stock/filings?symbol=${t}&token=${apiKey}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const live = [];
      tickers.slice(0, 8).forEach((t, i) => {
        const data = results[i];
        if (!Array.isArray(data)) return;
        const meaningful = data
          .filter(f => MEANINGFUL_FORMS.has(f.form))
          .slice(0, 2)
          .map(f => ({
            tk: t,
            form: f.form,
            date: (f.filedDate || f.reportDate || "").slice(0, 10),
            summary: seedMap[t]?.tldr || "—",
            sentiment: seedMap[t]?.sentiment || null,
            url: f.reportUrl || f.filingUrl || null,
          }));
        live.push(...meaningful);
      });

      if (live.length > 0) {
        // Sort by date desc
        live.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        setFilings(live.slice(0, 10));
        setStatus("live");
      } else {
        setStatus("seed");
      }
    }).catch(() => setStatus("seed"));
  }, [tickers?.join(",")]);

  const rows = filings || (window.SE_CONFIG?.SEC_SEED || window.SE_SEED?.secFilings || [])
    .filter(f => MEANINGFUL_FORMS.has(f.form))
    .map(f => ({ tk: f.ticker || f.tk, form: f.form, date: f.date, summary: f.tldr || f.summary || "—", sentiment: f.sentiment || null }))
    .slice(0, 10);

  const badgeCls = status === "live" ? "badge-live" : "badge-cached";
  const badgeLabel = status === "live" ? "LIVE" : status === "loading" ? "LOADING" : "SEED";

  return (
    <Panel idx="06" title="SEC Tracker"
      headRight={<span className={"badge " + badgeCls}>FINNHUB · {badgeLabel}</span>}>
      <table className="sec-list">
        <thead>
          <tr>
            <th style={{ width: 56 }}>Ticker</th>
            <th style={{ width: 64 }}>Form</th>
            <th style={{ width: 96 }}>Date</th>
            <th>Gemma TL;DR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => {
            const formKey = f.form.replace(/[^A-Z0-9]/g, "");
            const edgarSearch = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.tk}&type=${encodeURIComponent(f.form)}&dateb=&owner=include&count=10`;
            const linkStyle = { color: "inherit", textDecoration: "none", cursor: "pointer" };
            const linkHover = e => e.currentTarget.style.textDecoration = "underline";
            const linkOut   = e => e.currentTarget.style.textDecoration = "none";
            return (
              <tr key={i} style={{ cursor: f.url ? "pointer" : "default" }}
                  onClick={() => f.url && window.open(f.url, "_blank", "noopener,noreferrer")}>
                <td>
                  <a href={edgarSearch} target="_blank" rel="noopener noreferrer"
                     style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkOut}
                     onClick={e => e.stopPropagation()}>
                    <span className="inv-ticker" style={{ fontFamily: "var(--mono)" }}>{f.tk}</span>
                  </a>
                </td>
                <td>
                  <a href={f.url || edgarSearch} target="_blank" rel="noopener noreferrer"
                     style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkOut}
                     onClick={e => e.stopPropagation()}>
                    <span className={"sec-form f-" + formKey}>{f.form}</span>
                  </a>
                </td>
                <td className="inv-muted">{f.date}</td>
                <td className="sec-summary">
                  {f.sentiment && (
                    <span className={"sent-pill sent-" + f.sentiment}>
                      {f.sentiment === "bull" ? "BULL" : f.sentiment === "bear" ? "BEAR" : "NEUT"}
                    </span>
                  )}
                  {f.summary}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

// ── Pixel Debate animation ─────────────────────────────────────────────────

const PIXEL_AGENTS = [
  { name: 'VALUE',  body: '#c8a030', head: '#e8c870', dark: '#7a5f10' },
  { name: 'GROWTH', body: '#3080c8', head: '#70b0e8', dark: '#103878' },
  { name: 'QUANT',  body: '#8030c8', head: '#b070e8', dark: '#401078' },
  { name: 'RISK',   body: '#c83030', head: '#e87070', dark: '#781010' },
  { name: 'MACRO',  body: '#20a880', head: '#60d8b0', dark: '#0e5a44' },
];

const BUBBLE_WORDS = ['DCF!', '+40%', 'RISK!', 'P/E?', 'FCF!', 'BUY!', 'MACRO', 'HOLD?', 'EPS↑', 'WACC'];

function PixelDebate({ elapsed, ticker, width = 220, height = 170, mono = 'monospace', fg3 = '#71717a', fg4 = '#52525b', bg1 = '#111114', accent = '#818cf8' }) {
  const canvasRef = useR3 ? useR3(null) : React.useRef(null);
  const animRef   = useR3 ? useR3(null) : React.useRef(null);

  useE3 ? useE3(draw, []) : React.useEffect(draw, []);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2 - 8;
    const r  = Math.min(W, H) * 0.30;

    // Pentagon layout
    const pos = PIXEL_AGENTS.map((_, i) => {
      const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

    let conns = [], bubbles = [], lastConn = 0, lastBubble = 0;

    function drawChar(x, y, agent, bob) {
      const P = 3;
      const bx = Math.round(x - 4.5 * P), by = Math.round(y - 9 * P + bob);
      // head
      ctx.fillStyle = agent.head;
      ctx.fillRect(bx + P,     by,       3*P, P);
      ctx.fillRect(bx,         by + P,   5*P, 2*P);
      ctx.fillRect(bx + P,     by + 3*P, 3*P, P);
      // eyes
      ctx.fillStyle = '#09090b';
      ctx.fillRect(bx + P,     by + P,   P, P);
      ctx.fillRect(bx + 3*P,   by + P,   P, P);
      // torso
      ctx.fillStyle = agent.body;
      ctx.fillRect(bx + P,   by + 4*P, 3*P, 3*P);
      ctx.fillRect(bx,       by + 5*P, P,   P);
      ctx.fillRect(bx + 4*P, by + 5*P, P,   P);
      // legs
      ctx.fillStyle = agent.dark;
      ctx.fillRect(bx + P,   by + 7*P, P, 2*P);
      ctx.fillRect(bx + 3*P, by + 7*P, P, 2*P);
      // name
      ctx.fillStyle = 'rgba(161,161,170,0.75)';
      ctx.font = '7px ' + mono;
      ctx.textAlign = 'center';
      ctx.fillText(agent.name, x, y + 4*P);
    }

    function drawConn(p1, p2, alpha) {
      ctx.save();
      ctx.strokeStyle = `rgba(129,140,248,${alpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y - 12);
      ctx.lineTo(p2.x, p2.y - 12);
      ctx.stroke();
      ctx.restore();
    }

    function drawBubble(x, y, text, alpha) {
      const w = text.length * 5 + 10;
      const bx = x - w/2, by = y - 38;
      ctx.fillStyle = `rgba(17,17,20,${alpha})`;
      ctx.fillRect(bx, by, w, 12);
      ctx.strokeStyle = `rgba(129,140,248,${alpha * 0.9})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, w, 12);
      ctx.fillStyle = `rgba(244,244,245,${alpha})`;
      ctx.font = '7px ' + mono;
      ctx.textAlign = 'center';
      ctx.fillText(text, x, by + 9);
    }

    function frame(ts) {
      const t = ts / 1000;
      ctx.clearRect(0, 0, W, H);

      // Refresh debate connections every 2.2s
      if (t - lastConn > 2.2) {
        lastConn = t;
        const pairs = [];
        for (let a = 0; a < 5; a++)
          for (let b = a+1; b < 5; b++) pairs.push([a, b]);
        pairs.sort(() => Math.random() - 0.5);
        conns = pairs.slice(0, 2 + Math.floor(Math.random() * 2)).map(([a, b]) => ({ a, b, born: t }));
      }

      // New speech bubble every 1.4s
      if (t - lastBubble > 1.4) {
        lastBubble = t;
        bubbles.push({ i: Math.floor(Math.random() * 5), text: BUBBLE_WORDS[Math.floor(Math.random() * BUBBLE_WORDS.length)], born: t });
        if (bubbles.length > 4) bubbles.shift();
      }

      // Draw connections
      conns.forEach(c => {
        const age = t - c.born;
        const alpha = age < 0.25 ? age/0.25 : age < 1.6 ? 1 : Math.max(0, 1 - (age-1.6)/0.6);
        if (alpha > 0) drawConn(pos[c.a], pos[c.b], alpha * 0.55);
      });

      // Draw characters (all bobbing simultaneously — parallel!)
      PIXEL_AGENTS.forEach((agent, i) => {
        const bob = Math.sin(t * 1.8 + i * 0.7) * 1.8;
        drawChar(pos[i].x, pos[i].y, agent, bob);
      });

      // Draw speech bubbles
      bubbles.forEach(b => {
        const age = t - b.born;
        const alpha = age < 0.15 ? age/0.15 : age < 0.9 ? 1 : Math.max(0, 1 - (age-0.9)/0.5);
        if (alpha > 0) drawBubble(pos[b.i].x, pos[b.i].y, b.text, alpha);
      });

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }

  const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
  const elapsedFmt = mins > 0 ? `${mins}m ${secs < 10 ? '0' : ''}${secs}s` : `${secs}s`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <canvas ref={canvasRef} width={width} height={height} style={{ imageRendering: 'pixelated' }}/>
      <div style={{ fontFamily: mono, fontSize: 10, color: fg3, letterSpacing: '0.1em' }}>
        DEBATING {ticker ? ticker + ' · ' : ''}{elapsedFmt}
      </div>
      <div style={{ fontFamily: mono, fontSize: 9, color: fg4, letterSpacing: '0.08em' }}>
        5 AGENTS · PARALLEL · POLLING FOR RESULT
      </div>
    </div>
  );
}

// ── Sovereign DD ───────────────────────────────────────────────────────────

function SovereignDD({ ticker, onTickerChange }) {
  const [input, setInput] = useS3("");
  const [phase, setPhase] = useS3("idle");  // idle | running | result | error
  const [result, setResult] = useS3(null);
  const [elapsed, setElapsed] = useS3(0);
  const [errMsg, setErrMsg] = useS3("");
  const [analyzedTk, setAnalyzedTk] = useS3(null);
  const pollRef = useR3(null);
  const elapsedRef = useR3(null);
  const startRef = useR3(0);

  const stopAll = useC3(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  }, []);

  // When ticker selected from inventory/heatmap: update input + try to auto-load from KV
  useE3(() => {
    if (!ticker) return;
    setInput(ticker);

    // Try to load cached result from KV for this ticker
    if (ticker !== analyzedTk && phase !== "running") {
      fetch(`/api/dd/${ticker.toLowerCase()}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && (data.consensus_score != null || data.score != null)) {
            const mapped = mapDDResult(data);
            if (mapped) {
              setResult(mapped);
              setPhase("result");
              setAnalyzedTk(ticker);
            }
          } else if (phase === "result" && ticker !== analyzedTk) {
            // No result in KV for this ticker — clear display
            setResult(null);
            setPhase("idle");
          }
        })
        .catch(() => {});
    }
  }, [ticker]);

  useE3(() => () => stopAll(), []);

  const trigger = useC3(async () => {
    const tk = input.trim().toUpperCase();
    if (!tk) return;
    onTickerChange?.(tk);
    stopAll();
    setPhase("running");
    setResult(null);
    setElapsed(0);
    setErrMsg("");
    setAnalyzedTk(tk);
    startRef.current = Date.now();

    // Elapsed timer (ticks every second)
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    // Fire trigger
    try {
      await fetch("/api/dd/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk })
      });
    } catch (e) {
      // Trigger may fail (e.g. GH rate limit) but we still poll for existing results
    }

    // Poll /api/dd/{ticker} every 30s
    const doPoll = async () => {
      try {
        const r = await fetch(`/api/dd/${tk.toLowerCase()}`);
        if (r.ok) {
          const data = await r.json();
          if (data && (data.consensus_score != null || data.score != null)) {
            stopAll();
            const mapped = mapDDResult(data);
            if (mapped) {
              setResult(mapped);
              setPhase("result");
            }
          }
        }
      } catch {}
    };

    // First poll after 60s, then every 30s
    setTimeout(() => {
      doPoll();
      pollRef.current = setInterval(doPoll, 30_000);
    }, 60_000);
  }, [input]);

  // Phase badge
  const badge = phase === "running"
    ? <span className="badge badge-run">RUNNING · {fmtElapsed(elapsed)}</span>
    : phase === "result"
      ? <span className="badge badge-pos">COMPLETE</span>
      : phase === "error"
        ? <span className="badge badge-neg">ERROR</span>
        : <span className="badge">IDLE</span>;

  return (
    <Panel idx="07" title="Sovereign DD" headRight={badge}>
      <div className="dd">
        <div className="dd-input-row">
          <input
            value={input}
            placeholder="TICKER"
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") trigger(); }}
            disabled={phase === "running"}
          />
          <button onClick={trigger} disabled={phase === "running" || !input.trim()}>
            {phase === "running" ? "Running…" : "Analyze"}
          </button>
        </div>

        <div className="dd-body">
          {phase === "idle" && !result && (
            <div className="dd-empty">
              SOVEREIGN DD READY
              <div className="hint">Enter a ticker · 5-agent consensus · 5–10 min via GitHub Actions</div>
            </div>
          )}

          {phase === "running" && (
            <div className="dd-loading">
              <PixelDebate elapsed={elapsed} ticker={analyzedTk} mono="var(--mono)" fg3="var(--fg-3)" fg4="var(--fg-4)"/>
            </div>
          )}

          {phase === "error" && (
            <div className="dd-error">{errMsg || "Analysis failed — check GitHub Actions log."}</div>
          )}

          {(phase === "result" || (phase === "idle" && result)) && result && (
            <div className="dd-result">
              <div className="dd-head">
                <div className="dd-tk">{analyzedTk || input}</div>
                <div>
                  <span className="dd-score">{result.score.toFixed(1)}</span>
                  <span className="dd-score-max"> / 10</span>
                </div>
                <div className={"dd-grade " + result.grade}>{result.grade.replace(/-/g, " ")}</div>
              </div>
              {result.thesis && <div className="dd-thesis">{result.thesis}</div>}
              <div className="dd-kv">
                {result.swing && <><div className="k">Swing Factor</div><div className="v">{result.swing}</div></>}
                {result.confidence && <><div className="k">Confidence</div><div className="v" style={{ fontFamily: "var(--mono)", letterSpacing: "0.1em", fontSize: 11 }}>{result.confidence}</div></>}
              </div>
              {result.agents && result.agents.length > 0 && (
                <div className="dd-agents">
                  {result.agents.map((a, i) => (
                    <div className="dd-agent" key={i}>
                      <span className="a-name">{a.name}</span>
                      <span className={"a-vote " + a.vote}>{a.vote.toUpperCase()}</span>
                      <span className="a-note">{a.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── Sovereign Scout ────────────────────────────────────────────────────────

function SovereignScout() {
  const [scouts, setScouts] = useS3([]);
  const [status, setStatus] = useS3("loading"); // loading | hunting | live

  useE3(() => {
    fetch("/api/dd/scouts")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d) && d.length > 0) {
          setScouts(d);
          setStatus("live");
        } else {
          setStatus("hunting");
        }
      })
      .catch(() => setStatus("hunting"));
  }, []);

  // Normalise sovereign-dd shape → display shape
  const cards = useM3(() => scouts.map(s => ({
    tk: s.ticker || s.tk || "—",
    score: s.score ?? 0,
    grade: (s.grade ?? s.consensus_grade ?? "HOLD").replace(/ /g, "-").toUpperCase(),
    lens: s.scout_lens || s.lens || "—",
    rationale: s.gemma_rationale || s.rationale || s.thesis || "—",
    when: s.analyzed_at
      ? (() => {
          const diff = Date.now() - new Date(s.analyzed_at.replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6Z")).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        })()
      : (s.when || "—")
  })), [scouts]);

  const badge = status === "loading"
    ? <span className="badge">LOADING</span>
    : status === "hunting"
      ? <span className="badge badge-warn">HUNTING</span>
      : <span className="badge badge-pos">{cards.length} DISCOVER{cards.length !== 1 ? "IES" : "Y"}</span>;

  // Next scheduled run (6 AM ET)
  const nextRun = (() => {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const et = new Date(etStr);
    if (et.getHours() < 6) return "06:00 ET today";
    return "06:00 ET tomorrow";
  })();

  return (
    <Panel idx="08" title="Sovereign Scout" headRight={badge}>
      {(status === "loading" || status === "hunting") ? (
        <div className="scout-empty">
          <div className="hunting">SCOUT IS HUNTING</div>
          <div className="sub">Nightly screener · next run {nextRun}</div>
          <div className="sub" style={{ marginTop: 4 }}>6 FMP lenses → Gemma triage → 5-agent debate</div>
        </div>
      ) : (
        <div className="scout-list">
          {cards.map((s, i) => (
            <div className="scout-card" key={i}>
              <div className="scout-tk">
                {s.tk}
                <span className="lens">{s.lens}</span>
              </div>
              <div className="scout-mid">
                <div className="rationale">{s.rationale}</div>
                <div className="when">{s.when}</div>
              </div>
              <div className="scout-right">
                <div className="s">{s.score.toFixed(1)}<small>/10</small></div>
                <span className={"g " + s.grade}>{s.grade.replace(/-/g, " ")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

Object.assign(window, { SECTracker, SovereignDD, SovereignScout });
