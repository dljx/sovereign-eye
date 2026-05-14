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
  const d = data.result || data;
  const score = d.consensus_score ?? d.score ?? 0;
  const rawGrade = (d.consensus_grade ?? d.grade ?? "HOLD").trim();
  const grade = rawGrade.replace(/ /g, "-").toUpperCase();
  const confidence = d.confidence ?? "MEDIUM";
  const thesis = d.majority_thesis ?? d.thesis ?? "";
  const swing = d.key_swing_factor ?? d.swing ?? "";
  const agents = (d.agents || []).map(a => {
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

// ── Pixel Debate animation — delegates to shared DebateRoom ────────────────

function PixelDebate({ elapsed, ticker, liveEvents }) {
  // window.DebateRoom is loaded by debate-room.jsx (before this file)
  const DR = window.DebateRoom;
  if (!DR) return null;
  return <DR elapsed={elapsed} ticker={ticker} liveEvents={liveEvents} width={320} height={230}/>;
}

// ── Sovereign DD ───────────────────────────────────────────────────────────

function SovereignDD({ ticker, onTickerChange }) {
  const [input, setInput] = useS3("");
  const [phase, setPhase] = useS3("idle");  // idle | running | result | error
  const [result, setResult] = useS3(null);
  const [elapsed, setElapsed] = useS3(0);
  const [errMsg, setErrMsg] = useS3("");
  const [analyzedTk, setAnalyzedTk] = useS3(null);
  const [liveEvents, setLiveEvents] = useS3([]);
  const pollRef = useR3(null);
  const elapsedRef = useR3(null);
  const livePollRef = useR3(null);
  const liveCountRef = useR3(0);
  const startRef = useR3(0);

  const stopAll = useC3(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (livePollRef.current) { clearInterval(livePollRef.current); livePollRef.current = null; }
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
          const rd = data?.result || data;
          if (data && (rd.consensus_score != null || rd.score != null)) {
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
          const r2 = data?.result || data;
          if (data && (r2.consensus_score != null || r2.score != null)) {
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

    // Poll every 15s, starting immediately after a short delay
    setTimeout(() => {
      doPoll();
      pollRef.current = setInterval(doPoll, 15_000);
    }, 5_000);

    // Reset live event state for new run
    setLiveEvents([]);
    liveCountRef.current = 0;

    // Poll live events every 5s — animates agents as debate progresses
    const doLivePoll = async () => {
      try {
        const r = await fetch(`/api/dd/live/${tk.toLowerCase()}?after=${liveCountRef.current}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.events?.length) {
          setLiveEvents(prev => [...prev, ...data.events]);
          liveCountRef.current += data.events.length;
        }
        if (data.done) {
          clearInterval(livePollRef.current);
          livePollRef.current = null;
          doPoll(); // fetch final result immediately
        }
      } catch {}
    };
    livePollRef.current = setInterval(doLivePoll, 5_000);
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
            <div className="dd-loading" style={{ flex:1, minHeight:0 }}>
              <PixelDebate elapsed={elapsed} ticker={analyzedTk} liveEvents={liveEvents}/>
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
