// debate-room.jsx — Pixel art debate room
// Shared by desktop (bottom.jsx) and mobile (mobile.jsx).
// Always uses React.* directly — never hook aliases from bottom.jsx.

(function () {

const DR_COLORS = {
  floor0: '#0c0c11', floor1: '#10101a',
  grid:   '#181824',
  deskTop: '#5c3612', deskFront: '#3d2208', deskHi: '#7a4a1c',
  monBody: '#16162a', monStand: '#222233',
  shadow:  'rgba(0,0,0,0.32)',
  label:   'rgba(113,113,122,0.82)',
};

const DR_AGENTS = [
  { id: 'ValueHunter',  label: 'VALUE',  hair: '#b88820', shirt: '#a87818', pants: '#48300c', skin: '#e8b468' },
  { id: 'GrowthAlpha',  label: 'GROWTH', hair: '#4090d0', shirt: '#2870b8', pants: '#0c2868', skin: '#e8b468' },
  { id: 'QuantSignal',  label: 'QUANT',  hair: '#9050c0', shirt: '#7020a8', pants: '#2e0860', skin: '#e8b468' },
  { id: 'RiskSentinel', label: 'RISK',   hair: '#d04040', shirt: '#b01818', pants: '#580808', skin: '#e8b468' },
  { id: 'MacroLens',    label: 'MACRO',  hair: '#38b888', shirt: '#189870', pants: '#083828', skin: '#e8b468' },
];

const DR_GLOW = ['#fbbf24', '#60a5fa', '#818cf8', '#f87171', '#4ade80'];

function drIdx(name) {
  if (!name) return -1;
  const n = name.toLowerCase();
  if (n.includes('value'))  return 0;
  if (n.includes('growth')) return 1;
  if (n.includes('quant'))  return 2;
  if (n.includes('risk'))   return 3;
  if (n.includes('macro'))  return 4;
  return -1;
}

// Build a timed event queue from transcript (or agent_final_scores fallback).
function buildEventQueue(rawData) {
  const events = [];
  if (!rawData) return events;

  const r = rawData.result || rawData;
  const transcript = r.transcript || r.rounds || r.debate_log || r.debate_transcript || [];
  const agentScores = r.agent_final_scores || {};
  const grade = r.consensus_grade ?? 'HOLD';

  if (transcript.length > 0) {
    let t = 0.4;

    // R1 — initial scores
    const r1 = transcript.filter(e => String(e.round || '').toUpperCase() === 'R1');
    r1.forEach((e, j) => {
      const idx = drIdx(e.agent);
      if (idx < 0) return;
      events.push({ t: t + j * 1.0, type: 'SCORE', idx,
        text: `${(e.score || 0).toFixed(1)}`, color: '#a1a1aa' });
    });
    t += Math.max(r1.length * 1.0 + 1.5, 5);

    // R2 — challenges (challenger walks to target)
    const r2 = transcript.filter(e => String(e.round || '').toUpperCase() === 'R2' || (e.challenge && e.target_agent));
    r2.forEach(e => {
      const from = drIdx(e.agent);
      const to   = drIdx(e.target_agent || e.target);
      if (from < 0 || to < 0 || from === to) return;
      events.push({ t, type: 'WALK', from, to });
      t += 1.6;
      const txt = (e.challenge || '').slice(0, 28) || `CHALLENGE`;
      events.push({ t, type: 'BUBBLE', idx: from, text: txt, color: '#f87171' });
      t += 2.6;
      events.push({ t, type: 'RETURN', from });
      t += 1.8;
    });

    // R3 — revised scores (delta floats above agent)
    const r3 = transcript.filter(e => String(e.round || '').toUpperCase() === 'R3' ||
      (e.revised_score != null || e.score_delta != null));
    r3.forEach((e, j) => {
      const idx   = drIdx(e.agent);
      if (idx < 0) return;
      const delta = e.score_delta ?? e.delta ?? 0;
      const col   = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#a1a1aa';
      events.push({ t: t + j * 0.85, type: 'DELTA', idx,
        text: (delta >= 0 ? '+' : '') + delta.toFixed(1), color: col });
    });
    t += Math.max(r3.length * 0.85 + 1, 2);

    events.push({ t, type: 'CONSENSUS', grade });

  } else if (Object.keys(agentScores).length > 0) {
    // Fallback: simulate debate from agent_final_scores
    let t = 0.4;
    const ranked = Object.entries(agentScores)
      .map(([name, sc]) => ({ idx: drIdx(name), score: +sc }))
      .filter(x => x.idx >= 0)
      .sort((a, b) => b.score - a.score);

    ranked.forEach((p, j) => {
      const col = p.score >= 6.5 ? '#4ade80' : p.score <= 4.5 ? '#f87171' : '#a1a1aa';
      events.push({ t: t + j * 0.9, type: 'SCORE', idx: p.idx,
        text: p.score.toFixed(1), color: col });
    });
    t += ranked.length * 0.9 + 1.2;

    if (ranked.length >= 2) {
      const hi = ranked[0], lo = ranked[ranked.length - 1];
      events.push({ t, type: 'WALK', from: hi.idx, to: lo.idx });
      t += 1.8;
      events.push({ t, type: 'BUBBLE', idx: hi.idx,
        text: `BULLISH ${hi.score.toFixed(1)}`, color: '#4ade80' });
      t += 2.5;
      events.push({ t, type: 'RETURN', from: hi.idx });
      t += 1.8;
    }
    events.push({ t, type: 'CONSENSUS', grade });
  }

  return events;
}

// ── DebateRoom component ─────────────────────────────────────────────────────

function DebateRoom({ ddData = null, elapsed = 0, ticker = '', width = 320, height = 230 }) {
  const canvasRef = React.useRef(null);
  const rafRef    = React.useRef(null);
  const stateRef  = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const W = canvas.width, H = canvas.height;
    const P    = Math.max(1, Math.floor(Math.min(W, H) / 115));
    const TILE = P * 8;
    const MONO = '"JetBrains Mono", monospace';

    // Pentagon desk positions
    const cx = W / 2, cy = H * 0.52;
    const R  = Math.min(W, H) * 0.30;
    const deskPos = DR_AGENTS.map((_, i) => {
      const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
      return { x: Math.round(cx + R * Math.cos(a)), y: Math.round(cy + R * Math.sin(a)) };
    });

    const events   = buildEventQueue(ddData);
    const lastEvt  = events.length > 0 ? events[events.length - 1] : null;
    const DURATION = lastEvt ? lastEvt.t + 5 : 0; // 0 = no timed loop

    // Per-agent mutable state
    const agents = deskPos.map((dp) => ({
      x: dp.x, y: dp.y,
      tx: dp.x, ty: dp.y,
      hx: dp.x, hy: dp.y,
      state: 'TYPING',         // TYPING | WALKING
      dir:   'down',           // left | right | down
      walkFrame: 0, frameTick: 0,
      bubble: null,            // { text, color, t }
      delta:  null,            // { text, color, t }
    }));

    // Persist loop counters across frames
    stateRef.current = {
      t0: null, lastTs: null, prevSimT: 0,
      fired: new Set(),
      // "No data" random walk state
      noDataWalk: null,
      nextNoDataWalk: 2500,
    };

    // ── Floor ────────────────────────────────────────────────────────────────
    function drawFloor() {
      for (let ty = 0; ty < H; ty += TILE)
        for (let tx = 0; tx < W; tx += TILE) {
          ctx.fillStyle = ((tx / TILE + ty / TILE) % 2 < 1) ? DR_COLORS.floor0 : DR_COLORS.floor1;
          ctx.fillRect(tx, ty, TILE, TILE);
        }
      ctx.strokeStyle = DR_COLORS.grid;
      ctx.lineWidth   = 0.5;
      for (let x = 0; x <= W; x += TILE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }

    // ── Desk ─────────────────────────────────────────────────────────────────
    function drawDesk(x, y, i) {
      const dW = P * 14, dH = P * 6;
      // Shadow
      ctx.fillStyle = DR_COLORS.shadow;
      ctx.fillRect(x - dW / 2 + P, y - dH / 2 + P * 2, dW, dH);
      // Top surface
      ctx.fillStyle = DR_COLORS.deskTop;
      ctx.fillRect(x - dW / 2, y - dH / 2, dW, dH - P);
      // Highlight strip
      ctx.fillStyle = DR_COLORS.deskHi;
      ctx.fillRect(x - dW / 2, y - dH / 2, dW, P);
      // Front edge
      ctx.fillStyle = DR_COLORS.deskFront;
      ctx.fillRect(x - dW / 2, y + dH / 2 - P * 2, dW, P * 2);
      // Monitor stand
      ctx.fillStyle = DR_COLORS.monStand;
      ctx.fillRect(x - P, y - dH / 2 - P * 2, P * 2, P * 3);
      // Monitor body
      const mW = P * 10, mH = P * 7;
      ctx.fillStyle = DR_COLORS.monBody;
      ctx.fillRect(x - mW / 2, y - dH / 2 - mH - P * 2, mW, mH);
      // Screen glow
      ctx.fillStyle = DR_GLOW[i] + '55';
      ctx.fillRect(x - mW / 2 + P, y - dH / 2 - mH - P, mW - P * 2, mH - P * 2);
      // Screen data lines (static look — 3 rows of text-like marks)
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      const ly0 = y - dH / 2 - mH - P + P;
      const lineWidths = [0.75, 0.5, 0.65];
      for (let row = 0; row < 3; row++) {
        const lw = (mW - P * 4) * lineWidths[row];
        ctx.fillRect(x - mW / 2 + P * 2, ly0 + row * (P + 1), lw, Math.max(1, P - 1));
      }
    }

    // ── Character ────────────────────────────────────────────────────────────
    // Anchor: (x, y) = feet level.  Character extends up to y - 14*P.
    function drawChar(x, y, i, dir, wf, typing) {
      const ag = DR_AGENTS[i];

      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x - P * 3, y - P, P * 6, P);

      // Legs & shoes
      const stepL = (!typing && wf % 2 === 0) ? 0 : P;
      const stepR = (!typing && wf % 2 === 0) ? P : 0;
      ctx.fillStyle = ag.pants;
      ctx.fillRect(x - P * 2, y - P * 5 - stepL, P * 2, P * 5);
      ctx.fillRect(x,         y - P * 5 - stepR, P * 2, P * 5);
      ctx.fillStyle = '#0f0f16';
      ctx.fillRect(x - P * 3, y - P - stepL,     P * 3, P);
      ctx.fillRect(x + P,     y - P - stepR,     P * 2, P);

      // Torso
      ctx.fillStyle = ag.shirt;
      ctx.fillRect(x - P * 2, y - P * 10, P * 4, P * 5);

      // Arms
      const aSwing = typing ? 0 : (wf % 2 === 0 ? P : -P);
      ctx.fillStyle = ag.shirt;
      ctx.fillRect(x - P * 4, y - P * 10 + aSwing,  P * 2, P * 3);
      ctx.fillRect(x + P * 2, y - P * 10 - aSwing,  P * 2, P * 3);

      // Head (skin)
      ctx.fillStyle = ag.skin;
      ctx.fillRect(x - P * 2, y - P * 14, P * 4, P * 4);

      // Hair
      ctx.fillStyle = ag.hair;
      ctx.fillRect(x - P * 2, y - P * 14, P * 4, P * 2);          // top
      if (dir === 'left')  ctx.fillRect(x - P * 3, y - P * 14, P, P * 2); // side
      if (dir === 'right') ctx.fillRect(x + P * 2, y - P * 14, P, P * 2);

      // Eyes
      ctx.fillStyle = '#050508';
      if      (dir === 'right') ctx.fillRect(x + P,    y - P * 12, P, P);
      else if (dir === 'left')  ctx.fillRect(x - P * 2, y - P * 12, P, P);
      else { // forward
        ctx.fillRect(x - P,   y - P * 12, P, P);
        ctx.fillRect(x + P,   y - P * 12, P, P);
      }

      // Agent label (below feet)
      ctx.fillStyle = DR_COLORS.label;
      ctx.font = `${Math.max(6, P * 3)}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(ag.label, x, y + P);
    }

    // ── Speech bubble ────────────────────────────────────────────────────────
    function drawBubble(x, y, text, color, alpha) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      const fs = Math.max(6, P * 3);
      ctx.font = `${fs}px ${MONO}`;
      const tw = ctx.measureText(text).width;
      const pad = P * 3, bh = P * 7;
      const bw = tw + pad * 2;
      const bx = x - bw / 2;
      const by = y - P * 18 - bh;   // above character head

      // Box
      ctx.fillStyle = '#080810';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.5, P * 0.5);
      ctx.strokeRect(bx, by, bw, bh);

      // Pointer
      ctx.fillStyle = color;
      ctx.fillRect(x - P, by + bh, P * 2, P * 2);

      // Text
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, by + bh / 2);
      ctx.restore();
    }

    // ── Floating delta ───────────────────────────────────────────────────────
    function drawDelta(x, y, text, color, alpha) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${Math.max(7, P * 4)}px ${MONO}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
      ctx.restore();
    }

    // ── Main loop ────────────────────────────────────────────────────────────
    function frame(ts) {
      const st = stateRef.current;
      if (!st.t0) st.t0 = ts;
      const dt = st.lastTs ? Math.min((ts - st.lastTs) / 1000, 0.06) : 0.016;
      st.lastTs = ts;

      let simT = 0;

      if (DURATION > 0) {
        // Timed event replay mode
        simT = ((ts - st.t0) / 1000) % DURATION;

        // Detect loop reset
        if (st.prevSimT > simT + 1) {
          st.fired.clear();
          agents.forEach((a, i) => {
            a.x = deskPos[i].x; a.y = deskPos[i].y;
            a.tx = deskPos[i].x; a.ty = deskPos[i].y;
            a.state = 'TYPING'; a.dir = 'down';
            a.walkFrame = 0; a.frameTick = 0;
            a.bubble = null; a.delta = null;
          });
        }
        st.prevSimT = simT;

        // Fire events
        events.forEach((ev, k) => {
          if (st.fired.has(k) || ev.t > simT) return;
          st.fired.add(k);

          if (ev.type === 'WALK') {
            agents[ev.from].tx = deskPos[ev.to].x;
            agents[ev.from].ty = deskPos[ev.to].y;
          } else if (ev.type === 'RETURN') {
            agents[ev.from].tx = agents[ev.from].hx;
            agents[ev.from].ty = agents[ev.from].hy;
            agents[ev.from].bubble = null;
          } else if (ev.type === 'BUBBLE' || ev.type === 'SCORE') {
            agents[ev.idx].bubble = { text: ev.text, color: ev.color, t: simT };
          } else if (ev.type === 'DELTA') {
            agents[ev.idx].delta = { text: ev.text, color: ev.color, t: simT };
          } else if (ev.type === 'CONSENSUS') {
            agents.forEach((a, i) => {
              a.tx = deskPos[i].x; a.ty = deskPos[i].y;
              a.dir = 'down';
              a.bubble = { text: ev.grade, color: '#818cf8', t: simT };
            });
          }
        });

      } else {
        // No-data mode — random walks every few seconds
        simT = (ts - st.t0) / 1000;
        const msElapsed = ts - st.t0;

        if (!st.noDataWalk && msElapsed > st.nextNoDataWalk) {
          const from = Math.floor(Math.random() * 5);
          const to   = [0, 1, 2, 3, 4].filter(x => x !== from)[Math.floor(Math.random() * 4)];
          agents[from].tx = deskPos[to].x;
          agents[from].ty = deskPos[to].y;
          st.noDataWalk = { from, returnAt: msElapsed + 2800 };
        }

        if (st.noDataWalk && msElapsed > st.noDataWalk.returnAt) {
          const { from } = st.noDataWalk;
          // Check if they've arrived before sending home
          const dist = Math.hypot(agents[from].x - agents[from].tx, agents[from].y - agents[from].ty);
          if (dist < P * 2) {
            agents[from].tx = agents[from].hx;
            agents[from].ty = agents[from].hy;
            const homeArrivalDist = Math.hypot(agents[from].x - agents[from].hx, agents[from].y - agents[from].hy);
            if (homeArrivalDist < P * 2) {
              st.noDataWalk = null;
              st.nextNoDataWalk = msElapsed + 3000 + Math.random() * 2500;
            }
          }
        }
      }

      // Move agents toward targets
      agents.forEach(a => {
        const dx = a.tx - a.x, dy = a.ty - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist > P * 0.5) {
          const step = Math.min(P * 100 * dt, dist);
          a.x += (dx / dist) * step;
          a.y += (dy / dist) * step;
          a.state = 'WALKING';
          a.frameTick += dt;
          if (a.frameTick > 0.11) { a.walkFrame++; a.frameTick = 0; }
          a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'down');
        } else {
          a.x = a.tx; a.y = a.ty;
          if (a.state === 'WALKING') { a.state = 'TYPING'; a.dir = 'down'; }
        }
      });

      // ── Render ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);
      drawFloor();

      // Z-order by Y (painter's algorithm)
      const zOrder = agents.map((a, i) => ({ i, y: a.y })).sort((a, b) => a.y - b.y);

      // Desks first (sorted by desk Y, not character Y)
      const deskZ = deskPos.map((dp, i) => ({ i, y: dp.y })).sort((a, b) => a.y - b.y);
      deskZ.forEach(({ i }) => drawDesk(deskPos[i].x, deskPos[i].y, i));

      // Characters
      zOrder.forEach(({ i }) => {
        const a = agents[i];
        drawChar(Math.round(a.x), Math.round(a.y), i, a.dir, a.walkFrame, a.state === 'TYPING');
      });

      // Overlays (bubbles + deltas always on top)
      zOrder.forEach(({ i }) => {
        const a = agents[i];
        if (a.bubble) {
          const age = simT - a.bubble.t;
          const alpha = age < 0.2 ? age / 0.2 : age < 2.8 ? 1 : Math.max(0, 1 - (age - 2.8) / 0.9);
          drawBubble(Math.round(a.x), Math.round(a.y), a.bubble.text, a.bubble.color, alpha);
          if (alpha <= 0) a.bubble = null;
        }
        if (a.delta) {
          const age = simT - a.delta.t;
          const floatY = Math.round(a.y - P * 20 - age * P * 14);
          const alpha = age < 0.15 ? age / 0.15 : age < 1.4 ? 1 : Math.max(0, 1 - (age - 1.4) / 0.5);
          drawDelta(Math.round(a.x), floatY, a.delta.text, a.delta.color, alpha);
          if (alpha <= 0) a.delta = null;
        }
      });

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [ddData, width, height]);

  const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
  const elFmt = mins > 0 ? `${mins}m ${secs < 10 ? '0' : ''}${secs}s` : `${elapsed}s`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '6px 0' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ imageRendering: 'pixelated', display: 'block' }}
      />
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: '#71717a', letterSpacing: '0.1em' }}>
        {ticker ? `DEBATING ${ticker.toUpperCase()} · ` : 'AGENTS IN SESSION · '}{elFmt}
      </div>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: '#52525b', letterSpacing: '0.08em' }}>
        5 AGENTS · SOVEREIGN DD
      </div>
    </div>
  );
}

window.DebateRoom = DebateRoom;

})();
