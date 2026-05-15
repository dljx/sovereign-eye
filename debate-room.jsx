// debate-room.jsx v5 — Pixel art debate room + fetcher agent dossier phase
// Uses actual assets from pablodelucca/pixel-agents (MIT licensed):
//   • char_0–4.png  — 16×32 character sprite sheets
//   • floor_0.png   — 16×16 floor tile (HSB-colorized per zone)
//   • wall_0.png    — wall tile
//   • DESK/DESK_FRONT.png — desk furniture sprite
// Shared by index.html (desktop) and mobile.html.

(function () {

// ── Asset base URLs ───────────────────────────────────────────────────────────
const REPO = 'https://raw.githubusercontent.com/pablodelucca/pixel-agents/main/webview-ui/public/assets/';
const CHAR_BASE = REPO + 'characters/';
const FLOOR_URL = REPO + 'floors/floor_0.png';
const WALL_URL  = REPO + 'walls/wall_0.png';
const DESK_URL  = REPO + 'furniture/DESK/DESK_FRONT.png';

// ── Sprite sheet layout ───────────────────────────────────────────────────────
const CHAR_W = 16, CHAR_H = 32;
const SPRITE_DIRS  = ['down', 'up', 'right'];
const WALK_CYCLE   = [0, 1, 2, 1];   // indices into direction row
const TYPE_CYCLE   = [3, 4];

// ── Zone color shifts (from default-layout-1.json) ───────────────────────────
// Applied to floor_0.png (grayscale tile) via HSL shift.
const ZONE_SHIFTS = {
  7: { h: 25,  s:  0.48, b: -0.43 },   // warm orange (left side of room)
  1: { h: 209, s:  0.39, b: -0.25 },   // cool blue   (right side)
  9: { h: 209, s:  0.00, b: -0.16 },   // neutral light (transition/corridor)
  0: { h: 214, s:  0.30, b: -0.70 },   // dark border
};

// ── Agent definitions ─────────────────────────────────────────────────────────
const DR_AGENTS = [
  { id: 'ValueHunter',  label: 'VALUE',  charIdx: 0, accent: '#fbbf24' },
  { id: 'GrowthAlpha',  label: 'GROWTH', charIdx: 1, accent: '#60a5fa' },
  { id: 'QuantSignal',  label: 'QUANT',  charIdx: 2, accent: '#818cf8' },
  { id: 'RiskSentinel', label: 'RISK',   charIdx: 3, accent: '#f87171' },
  { id: 'MacroLens',    label: 'MACRO',  charIdx: 4, accent: '#4ade80' },
];
// Fetcher agent — appears only during dossier-building phase
const FETCHER_AGENT = { id: 'Fetcher', label: 'FETCH', charIdx: 2, accent: '#e879f9' };

// ── Colour helpers ────────────────────────────────────────────────────────────
function rgbToHsl(r, g, b) {
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch (max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      default:h = ((r-g)/d + 4)/6;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v=l; return [v,v,v]; }
  const hue2rgb = (p,q,t) => {
    if (t<0) t+=1; if (t>1) t-=1;
    if (t<1/6) return p+(q-p)*6*t;
    if (t<1/2) return q;
    if (t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  };
  const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  return [hue2rgb(p,q,h+1/3), hue2rgb(p,q,h), hue2rgb(p,q,h-1/3)];
}

// ── Image loading + pixel extraction ─────────────────────────────────────────
function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function imgToOffscreen(imgEl) {
  if (!imgEl) return null;
  const W = imgEl.naturalWidth || imgEl.width;
  const H = imgEl.naturalHeight || imgEl.height;
  if (!W || !H) return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(imgEl, 0, 0);
  return c;
}

// Colorize a grayscale offscreen canvas via HSL shift → return new offscreen canvas
function colorizeCanvas(src, shift) {
  if (!src) return null;
  const W = src.width, H = src.height;
  const dst = document.createElement('canvas');
  dst.width = W; dst.height = H;
  const ctx = dst.getContext('2d');
  ctx.drawImage(src, 0, 0);
  let data;
  try { data = ctx.getImageData(0, 0, W, H); } catch(_) { return src; }
  const px = data.data;
  const { h, s, b } = shift;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i+3] < 10) continue;
    let [hh, ss, ll] = rgbToHsl(px[i]/255, px[i+1]/255, px[i+2]/255);
    hh = ((hh + h/360) % 1 + 1) % 1;
    ss = Math.max(0, Math.min(1, ss + s));
    ll = Math.max(0, Math.min(1, ll + b));
    const [r, g, bv] = hslToRgb(hh, ss, ll);
    px[i] = r*255; px[i+1] = g*255; px[i+2] = bv*255;
  }
  ctx.putImageData(data, 0, 0);
  return dst;
}

// Extract character sprite frames from sheet
function extractCharFrames(imgEl) {
  const src = imgToOffscreen(imgEl);
  if (!src) return null;
  const W = src.width, H = src.height;
  const cols = Math.round(W / CHAR_W);
  const rows = Math.min(Math.round(H / CHAR_H), SPRITE_DIRS.length);
  const ctx = src.getContext('2d');
  let imgData;
  try { imgData = ctx.getImageData(0, 0, W, H); } catch(_) { return null; }
  const px = imgData.data;

  const sprites = {};
  SPRITE_DIRS.slice(0, rows).forEach((dir, row) => {
    sprites[dir] = [];
    for (let col = 0; col < cols; col++) {
      const frame = [];
      for (let fy = 0; fy < CHAR_H; fy++) {
        const rowArr = [];
        for (let fx = 0; fx < CHAR_W; fx++) {
          const i = ((row*CHAR_H + fy)*W + (col*CHAR_W + fx))*4;
          const a = px[i+3];
          if (a < 10) { rowArr.push(''); continue; }
          rowArr.push(
            '#' + px[i  ].toString(16).padStart(2,'0')
               + px[i+1].toString(16).padStart(2,'0')
               + px[i+2].toString(16).padStart(2,'0')
          );
        }
        frame.push(rowArr);
      }
      sprites[dir].push(frame);
    }
  });
  if (!sprites.up)    sprites.up    = sprites.down  || [];
  if (!sprites.right) sprites.right = sprites.down  || [];
  sprites.left = sprites.right.map(fr => fr.map(r => [...r].reverse()));
  return sprites;
}

function getFrame(sprites, dir, state, step) {
  if (!sprites) return null;
  const frames = sprites[dir] || sprites.down;
  if (!frames || !frames.length) return null;
  const cycle = state === 'WALKING' ? WALK_CYCLE : TYPE_CYCLE;
  return frames[cycle[step % cycle.length]] || null;
}

function drawSpriteFrame(ctx, frame, x, y, P) {
  if (!frame) return;
  for (let fy = 0; fy < frame.length; fy++)
    for (let fx = 0; fx < frame[fy].length; fx++) {
      const c = frame[fy][fx];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x + fx*P, y + fy*P, P, P);
    }
}

// ── Load all room assets ──────────────────────────────────────────────────────
// Module-level cache — assets are only fetched once regardless of how many
// DebateRoom components mount/unmount across ticker selections.
let _assetCache = null;

async function loadAllAssets() {
  if (_assetCache) return _assetCache;
  const [floorImg, wallImg, deskImg, ...charImgs] = await Promise.all([
    loadImage(FLOOR_URL),
    loadImage(WALL_URL),
    loadImage(DESK_URL),
    ...DR_AGENTS.map(a => loadImage(`${CHAR_BASE}char_${a.charIdx}.png`)),
    loadImage(`${CHAR_BASE}char_${FETCHER_AGENT.charIdx}.png`), // fetcher (same sheet, magenta tint)
  ]);

  // Colorized floor tiles per zone
  const floorBase = imgToOffscreen(floorImg);
  const floorTiles = {};
  for (const [zone, shift] of Object.entries(ZONE_SHIFTS)) {
    floorTiles[zone] = colorizeCanvas(floorBase, shift);
  }

  const wallTile = imgToOffscreen(wallImg);
  const deskSprite = imgToOffscreen(deskImg);
  // charImgs: first 5 are DR_AGENTS, last one is fetcher
  const charSprites = charImgs.slice(0, 5).map(img => extractCharFrames(img));
  const fetcherSprite = extractCharFrames(charImgs[5] || charImgs[FETCHER_AGENT.charIdx]);

  _assetCache = { floorTiles, wallTile, deskSprite, charSprites, fetcherSprite };
  return _assetCache;
}

// ── Fallback solid-colour floor tile ─────────────────────────────────────────
// Used when CORS blocks the PNG fetch.
const ZONE_FALLBACK_COLORS = { 7: '#1a1008', 1: '#0c1520', 9: '#121520', 0: '#050508' };

function drawFloorFallback(ctx, W, H) {
  const TILE = 16;
  for (let ty = 0; ty < H; ty += TILE)
    for (let tx = 0; tx < W; tx += TILE) {
      const zoneX = tx < W/2 ? 7 : 1;
      ctx.fillStyle = ZONE_FALLBACK_COLORS[zoneX] || '#0e0e14';
      ctx.fillRect(tx, ty, TILE, TILE);
    }
  ctx.strokeStyle = '#0a0a10';
  ctx.lineWidth = 0.5;
  for (let x=0;x<=W;x+=TILE){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for (let y=0;y<=H;y+=TILE){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
}

// ── Room rendering ────────────────────────────────────────────────────────────
// Renders the office background: floor tiles (two colour zones) + back wall strip.
// Matches the pixel-agents default-layout-1 look: warm orange (left) / cool blue (right).
function drawRoom(ctx, W, H, assets, P) {
  const { floorTiles, wallTile } = assets;
  const TILE = floorTiles[7] ? floorTiles[7].width : 16; // native tile size (16px)
  const WALL_H_TILES = 2;   // wall rows at top
  const wallPx = WALL_H_TILES * TILE * P;

  if (!floorTiles[7]) {
    // Fallback when assets didn't load
    drawFloorFallback(ctx, W, H);
    return;
  }

  // Draw floor — zone 7 (orange/warm) left half, zone 1 (blue/cool) right half
  for (let ty = 0; ty < H; ty += TILE * P) {
    for (let tx = 0; tx < W; tx += TILE * P) {
      const isWallRow = ty < wallPx;
      // Pick zone: wall rows use zone 0 (dark), floor uses left/right split
      let zone;
      if (isWallRow) {
        zone = 0;
      } else {
        zone = tx < W / 2 ? 7 : 1;
      }
      const tile = floorTiles[zone] || floorTiles[7];
      if (tile) {
        ctx.drawImage(tile, 0, 0, TILE, TILE, tx, ty, TILE * P, TILE * P);
      } else {
        ctx.fillStyle = ZONE_FALLBACK_COLORS[zone] || '#0e0e14';
        ctx.fillRect(tx, ty, TILE * P, TILE * P);
      }
    }
  }

  // Wall tile strip across the top (WALL_H_TILES rows)
  if (wallTile) {
    for (let tx = 0; tx < W; tx += TILE * P) {
      for (let row = 0; row < WALL_H_TILES; row++) {
        ctx.drawImage(wallTile, 0, 0, wallTile.width, wallTile.height,
          tx, row * TILE * P, TILE * P, TILE * P);
      }
    }
    // Skirting line
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, wallPx - P, W, P);
  }

  // Central divider line (matches room boundary between zones)
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(W/2 - P, wallPx, P*2, H - wallPx);

  // Subtle vignette
  const vg = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ── Desk drawing ──────────────────────────────────────────────────────────────
function drawDesk(ctx, x, y, agentIdx, assets, P) {
  const { deskSprite } = assets;
  const accent = DR_AGENTS[agentIdx].accent;

  if (deskSprite) {
    // Draw real desk sprite centred on (x, y)
    const dW = deskSprite.width * P, dH = deskSprite.height * P;
    ctx.drawImage(deskSprite, x - dW/2, y - dH/2, dW, dH);
  } else {
    // Fallback pixel desk
    const dW = 36, dH = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - dW/2 + 2, y + 2, dW, dH);
    ctx.fillStyle = '#5c3612';
    ctx.fillRect(x - dW/2, y, dW, dH - 3);
    ctx.fillStyle = '#7a4a1c';
    ctx.fillRect(x - dW/2, y, dW, 2);
    ctx.fillStyle = '#3d2208';
    ctx.fillRect(x - dW/2, y + dH - 4, dW, 4);
  }

  // Monitor (always drawn on top of desk sprite)
  const mW = P*10, mH = P*8;
  ctx.fillStyle = '#14142a';
  ctx.fillRect(x - mW/2, y - mH - P*2, mW, mH);
  ctx.strokeStyle = '#252540';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - mW/2, y - mH - P*2, mW, mH);
  // Screen glow
  ctx.fillStyle = accent + '45';
  ctx.fillRect(x - mW/2 + P, y - mH - P, mW - P*2, mH - P*2);
  // Screen data lines
  ctx.fillStyle = accent + '80';
  [[0.75,0],[0.5,4],[0.65,8]].forEach(([w, oy]) =>
    ctx.fillRect(x - mW/2 + P*2, y - mH - P + P*2 + oy, (mW-P*4)*w, Math.max(1,P-1))
  );
  // Stand
  ctx.fillStyle = '#2a2a3e';
  ctx.fillRect(x - P, y - P*3, P*2, P*4);
}

// ── Speech bubble + delta ─────────────────────────────────────────────────────
function drawBubble(ctx, charX, charY, text, color, alpha, P) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const fs = Math.max(6, P*3);
  ctx.font = `${fs}px "JetBrains Mono", monospace`;
  const tw = ctx.measureText(text).width;
  const pad = P*3, bh = P*7, bw = tw + pad*2;
  const bx = charX - bw/2, by = charY - CHAR_H*P - P*6 - bh;
  ctx.fillStyle = '#08080e';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, P*0.5);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = color;
  ctx.fillRect(charX - P, by+bh, P*2, P*2);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, charX, by+bh/2);
  ctx.restore();
}

function drawDelta(ctx, x, y, text, color, alpha, P) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${Math.max(7, P*4)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ── Event queue ───────────────────────────────────────────────────────────────
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

function buildEventQueue(rawData) {
  const events = [];
  if (!rawData) return events;
  const r = rawData.result || rawData;
  const transcript  = r.transcript || r.rounds || r.debate_log || r.debate_transcript || [];
  const agentScores = r.agent_final_scores || {};
  const grade       = r.consensus_grade ?? 'HOLD';

  if (transcript.length > 0) {
    let t = 0.4;
    const r1 = transcript.filter(e => String(e.round||'').toUpperCase() === 'R1');
    r1.forEach((e,j) => {
      const idx = drIdx(e.agent); if (idx<0) return;
      events.push({ t: t+j*1.0, type:'SCORE', idx, text:`${(e.score||0).toFixed(1)}`, color:'#a1a1aa' });
    });
    t += Math.max(r1.length*1.0+1.5, 5);

    const r2 = transcript.filter(e => String(e.round||'').toUpperCase()==='R2' || (e.challenge && e.target_agent));
    r2.forEach(e => {
      const from=drIdx(e.agent), to=drIdx(e.target_agent||e.target);
      if (from<0||to<0||from===to) return;
      events.push({ t, type:'WALK', from, to });
      t += 1.6;
      events.push({ t, type:'BUBBLE', idx:from, text:(e.challenge||'').slice(0,26)||'CHALLENGE', color:'#f87171' });
      t += 2.6;
      events.push({ t, type:'RETURN', from });
      t += 1.8;
    });

    const r3 = transcript.filter(e => String(e.round||'').toUpperCase()==='R3'||e.revised_score!=null||e.score_delta!=null);
    r3.forEach((e,j) => {
      const idx=drIdx(e.agent); if (idx<0) return;
      const delta=e.score_delta??e.delta??0;
      const col=delta>0?'#4ade80':delta<0?'#f87171':'#a1a1aa';
      events.push({ t:t+j*0.85, type:'DELTA', idx, text:(delta>=0?'+':'')+delta.toFixed(1), color:col });
    });
    t += Math.max(r3.length*0.85+1, 2);
    events.push({ t, type:'CONSENSUS', grade });

  } else if (Object.keys(agentScores).length > 0) {
    let t = 0.4;
    const ranked = Object.entries(agentScores)
      .map(([name,sc]) => ({ idx:drIdx(name), score:+sc }))
      .filter(x => x.idx>=0)
      .sort((a,b) => b.score-a.score);
    ranked.forEach((p,j) => {
      const col=p.score>=6.5?'#4ade80':p.score<=4.5?'#f87171':'#a1a1aa';
      events.push({ t:t+j*0.9, type:'SCORE', idx:p.idx, text:p.score.toFixed(1), color:col });
    });
    t += ranked.length*0.9+1.2;
    if (ranked.length>=2) {
      const hi=ranked[0], lo=ranked[ranked.length-1];
      events.push({ t, type:'WALK', from:hi.idx, to:lo.idx });
      t += 1.8;
      events.push({ t, type:'BUBBLE', idx:hi.idx, text:`BULLISH ${hi.score.toFixed(1)}`, color:'#4ade80' });
      t += 2.5;
      events.push({ t, type:'RETURN', from:hi.idx });
      t += 1.8;
    }
    events.push({ t, type:'CONSENSUS', grade });
  }
  return events;
}

// ── DebateRoom component ──────────────────────────────────────────────────────
function DebateRoom({ ddData = null, elapsed = 0, ticker = '', liveEvents = null, isRunning = false, width = 380, height = 280 }) {
  const canvasRef  = React.useRef(null);
  const wrapRef    = React.useRef(null);
  const rafRef     = React.useRef(null);
  const stateRef   = React.useRef(null);
  const [assets, setAssets]       = React.useState(null);
  const [assetsReady, setReady]   = React.useState(false);
  const [canvasSize, setCanvasSize] = React.useState({ w: width, h: height });
  const elapsedRef = React.useRef(elapsed);
  React.useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  const tickerRef = React.useRef(ticker);
  React.useEffect(() => { tickerRef.current = ticker; }, [ticker]);
  // liveEvents arrives as a growing array from the parent — use a ref so
  // the animation loop always reads the latest slice without restarting.
  const liveRef = React.useRef(liveEvents || []);
  React.useEffect(() => { liveRef.current = liveEvents || []; }, [liveEvents]);
  const isRunningRef = React.useRef(isRunning);
  React.useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  // Fill container — resize observer reads both width and height
  React.useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width: cw, height: ch } = entries[0].contentRect;
      if (cw > 10 && ch > 10) setCanvasSize({ w: Math.floor(cw), h: Math.floor(ch) });
    });
    obs.observe(wrapRef.current);
    // Seed immediately
    const cw = Math.floor(wrapRef.current.offsetWidth);
    const ch = Math.floor(wrapRef.current.offsetHeight);
    if (cw > 10 && ch > 10) setCanvasSize({ w: cw, h: ch });
    return () => obs.disconnect();
  }, []);

  // Load all assets once
  React.useEffect(() => {
    loadAllAssets().then(a => { setAssets(a); setReady(true); });
  }, []);

  // Animation loop — waits for asset load attempt (succeeds or fails gracefully)
  React.useEffect(() => {
    if (!assetsReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const W = canvas.width, H = canvas.height;
    // P = scale factor. At P=2: 16px tile → 32px, 16×32 char → 32×64.
    const P = Math.max(1, Math.floor(Math.min(W,H) / 140));

    // Pentagon layout — centre pushed down to avoid top-character clipping
    const cx = W/2, cy = H*0.55;
    const R  = Math.min(W,H)*0.27;
    const deskPos = DR_AGENTS.map((_,i) => {
      const a = (i*2*Math.PI/5) - Math.PI/2;
      return { x: Math.round(cx + R*Math.cos(a)), y: Math.round(cy + R*Math.sin(a)) };
    });

    const events   = buildEventQueue(ddData);
    const lastEvt  = events.length > 0 ? events[events.length-1] : null;
    const DURATION = lastEvt ? lastEvt.t + 5 : 0;

    const agents = deskPos.map(dp => ({
      x:dp.x, y:dp.y, tx:dp.x, ty:dp.y, hx:dp.x, hy:dp.y,
      state:'TYPING', dir:'down',
      animStep:0, animTick:0,
      bubble:null, delta:null,
    }));

    // Station positions for fetcher — 5 spots around the room perimeter
    const stationPos = [
      { x: Math.round(W*0.15), y: Math.round(H*0.28) },
      { x: Math.round(W*0.85), y: Math.round(H*0.28) },
      { x: Math.round(W*0.15), y: Math.round(H*0.72) },
      { x: Math.round(W*0.85), y: Math.round(H*0.72) },
      { x: Math.round(W*0.50), y: Math.round(H*0.12) },
    ];

    // Fetcher agent — starts at center, visible only during dossier phase
    const fetcher = {
      x: Math.round(cx), y: Math.round(cy),
      tx: Math.round(cx), ty: Math.round(cy),
      hx: Math.round(cx), hy: Math.round(cy),
      state: 'TYPING', dir: 'down',
      animStep: 0, animTick: 0,
      bubble: null, delta: null,
      visible: false,
    };

    stateRef.current = {
      t0:null, lastTs:null, prevSimT:0, fired:new Set(),
      noDataWalk:null, nextNoDataWalk:2500,
      // Live mode
      liveProcessed:0, lastLiveEventT:-999, pendingActions:[],
      // Fetcher / dossier phase
      fetchCount:0, fetcherRef: fetcher, stationPos,
    };

    // Process a single live pipeline event into immediate agent state changes
    function applyLiveEvent(ev, simT) {
      const st = stateRef.current;
      const ft = st.fetcherRef;

      if (ev.type === 'DOSSIER_START') {
        ft.visible = true;
        ft.x = Math.round(cx); ft.y = Math.round(cy);
        ft.tx = Math.round(cx); ft.ty = Math.round(cy);
        ft.bubble = { text: 'FETCHING', color: '#e879f9', t: simT };
        return;
      }
      if (ev.type === 'FETCH_DONE') {
        if (!ft.visible) { ft.visible = true; ft.x = Math.round(cx); ft.y = Math.round(cy); }
        const sIdx = st.fetchCount % st.stationPos.length;
        const sp = st.stationPos[sIdx];
        ft.tx = sp.x; ft.ty = sp.y;
        const src = (ev.source || 'DATA').toUpperCase().replace(/_/g, ' ');
        const arriveT = simT + 0.7;
        st.pendingActions.push(
          { fireAt: arriveT, fn: () => { ft.bubble = { text: src, color: '#e879f9', t: arriveT }; } },
          { fireAt: arriveT + 1.2, fn: () => { ft.bubble = null; ft.tx = Math.round(cx); ft.ty = Math.round(cy); } }
        );
        st.fetchCount++;
        return;
      }
      if (ev.type === 'DOSSIER_DONE') {
        ft.tx = Math.round(cx); ft.ty = Math.round(cy);
        ft.bubble = { text: 'READY', color: '#4ade80', t: simT };
        st.pendingActions.push(
          { fireAt: simT + 2.0, fn: () => { ft.visible = false; ft.bubble = null; } }
        );
        return;
      }

      if (ev.type === 'START') return;
      if (ev.type === 'DONE') return;

      if (ev.type === 'R1_SCORE') {
        const idx = drIdx(ev.agent); if (idx < 0) return;
        const score = +(ev.score || 0);
        const col = score >= 6.5 ? '#4ade80' : score <= 4.5 ? '#f87171' : '#a1a1aa';
        agents[idx].bubble = { text: score.toFixed(1), color: col, t: simT };
      }
      else if (ev.type === 'R2_CHALLENGE') {
        const from = drIdx(ev.agent), to = drIdx(ev.target);
        if (from < 0 || to < 0 || from === to) return;
        // Walk to target
        agents[from].tx = deskPos[to].x;
        agents[from].ty = deskPos[to].y;
        // Show challenge bubble after walk delay
        const snippet = (ev.challenge || 'CHALLENGE').slice(0, 26);
        st.pendingActions.push(
          { fireAt: simT + 1.6, fn: () => { agents[from].bubble = { text: snippet, color: '#f87171', t: simT+1.6 }; } },
          { fireAt: simT + 4.2, fn: () => { agents[from].bubble = null; agents[from].tx = agents[from].hx; agents[from].ty = agents[from].hy; } }
        );
      }
      else if (ev.type === 'R3_DELTA') {
        const idx = drIdx(ev.agent); if (idx < 0) return;
        const delta = +(ev.delta ?? ev.score_delta ?? 0);
        const col = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#a1a1aa';
        agents[idx].delta = { text: (delta >= 0 ? '+' : '') + delta.toFixed(1), color: col, t: simT };
      }
      else if (ev.type === 'CONSENSUS') {
        const grade = (ev.grade || 'HOLD').replace(/-/g, ' ');
        agents.forEach((a, i) => {
          a.tx = deskPos[i].x; a.ty = deskPos[i].y; a.dir = 'down';
          a.bubble = { text: grade, color: '#818cf8', t: simT };
        });
      }
    }

    function frame(ts) {
      const st = stateRef.current;
      if (!st.t0) st.t0 = ts;
      const dt = st.lastTs ? Math.min((ts-st.lastTs)/1000, 0.05) : 0.016;
      st.lastTs = ts;
      let simT = 0;

      // ── Live mode: process arriving pipeline events ────────────────────────
      const live = liveRef.current;
      const isRun = isRunningRef.current;
      if (live && live.length > 0) {
        simT = (ts - st.t0) / 1000; // monotonic, no looping

        // Fire any pending delayed actions (walk → bubble → return sequences)
        st.pendingActions = st.pendingActions.filter(a => {
          if (simT >= a.fireAt) { a.fn(); return false; }
          return true;
        });

        // Process new live events with a minimum gap between them
        while (st.liveProcessed < live.length) {
          if (simT - st.lastLiveEventT < 0.7) break; // stagger events
          applyLiveEvent(live[st.liveProcessed], simT);
          st.lastLiveEventT = simT;
          st.liveProcessed++;
        }

      } else if (isRun) {
        // ── Waiting mode: run triggered but no events yet (dossier compiling) ─
        // Debate agents stay at desks. Fetcher wanders between stations.
        simT = (ts - st.t0) / 1000;
        const ms = ts - st.t0;
        const ft2 = st.fetcherRef;
        ft2.visible = true;
        if (!st.noDataWalk && ms > st.nextNoDataWalk) {
          const sIdx = Math.floor(Math.random() * st.stationPos.length);
          ft2.tx = st.stationPos[sIdx].x;
          ft2.ty = st.stationPos[sIdx].y;
          st.noDataWalk = { returnAt: ms + 1800 };
        }
        if (st.noDataWalk) {
          const atStn = Math.hypot(ft2.x-ft2.tx, ft2.y-ft2.ty) < P*2;
          if (atStn && ms > st.noDataWalk.returnAt) {
            ft2.tx = Math.round(cx); ft2.ty = Math.round(cy);
            st.noDataWalk = null;
            st.nextNoDataWalk = ms + 1000 + Math.random()*1500;
          }
        }

      } else if (DURATION > 0) {
        // ── Replay mode: looping transcript animation ──────────────────────
        simT = ((ts-st.t0)/1000) % DURATION;
        if (st.prevSimT > simT+1) {
          st.fired.clear();
          agents.forEach((a,i) => {
            a.x=deskPos[i].x; a.y=deskPos[i].y;
            a.tx=deskPos[i].x; a.ty=deskPos[i].y;
            a.state='TYPING'; a.dir='down';
            a.animStep=0; a.animTick=0;
            a.bubble=null; a.delta=null;
          });
        }
        st.prevSimT = simT;

        events.forEach((ev,k) => {
          if (st.fired.has(k) || ev.t>simT) return;
          st.fired.add(k);
          if (ev.type==='WALK') {
            agents[ev.from].tx = deskPos[ev.to].x;
            agents[ev.from].ty = deskPos[ev.to].y;
          } else if (ev.type==='RETURN') {
            agents[ev.from].tx = agents[ev.from].hx;
            agents[ev.from].ty = agents[ev.from].hy;
            agents[ev.from].bubble = null;
          } else if (ev.type==='BUBBLE'||ev.type==='SCORE') {
            agents[ev.idx].bubble = { text:ev.text, color:ev.color, t:simT };
          } else if (ev.type==='DELTA') {
            agents[ev.idx].delta = { text:ev.text, color:ev.color, t:simT };
          } else if (ev.type==='CONSENSUS') {
            agents.forEach((a,i) => {
              a.tx=deskPos[i].x; a.ty=deskPos[i].y; a.dir='down';
              a.bubble = { text:ev.grade, color:'#818cf8', t:simT };
            });
          }
        });

      } else {
        // No transcript — random walk idle mode
        simT = (ts-st.t0)/1000;
        const ms = ts-st.t0;
        if (!st.noDataWalk && ms>st.nextNoDataWalk) {
          const from = Math.floor(Math.random()*5);
          const to   = [0,1,2,3,4].filter(x=>x!==from)[Math.floor(Math.random()*4)];
          agents[from].tx = deskPos[to].x;
          agents[from].ty = deskPos[to].y;
          st.noDataWalk = { from, returnAt:ms+2800, returning:false };
        }
        if (st.noDataWalk) {
          const { from } = st.noDataWalk;
          const atTarget = Math.hypot(agents[from].x-agents[from].tx, agents[from].y-agents[from].ty) < P*2;
          if (!st.noDataWalk.returning && ms>st.noDataWalk.returnAt && atTarget) {
            st.noDataWalk.returning = true;
            agents[from].tx = agents[from].hx;
            agents[from].ty = agents[from].hy;
          }
          if (st.noDataWalk.returning &&
              Math.hypot(agents[from].x-agents[from].hx, agents[from].y-agents[from].hy) < P*2) {
            st.noDataWalk = null;
            st.nextNoDataWalk = ms + 3000 + Math.random()*2500;
          }
        }
      }

      // Move agents
      agents.forEach(a => {
        const dx=a.tx-a.x, dy=a.ty-a.y;
        const dist = Math.hypot(dx,dy);
        if (dist > P*0.5) {
          const step = Math.min(P*80*dt, dist);
          a.x += (dx/dist)*step; a.y += (dy/dist)*step;
          a.state = 'WALKING';
          a.animTick += dt;
          if (a.animTick > 0.12) { a.animStep++; a.animTick=0; }
          a.dir = Math.abs(dx)>Math.abs(dy) ? (dx>0?'right':'left') : (dy>0?'down':'up');
        } else {
          a.x=a.tx; a.y=a.ty;
          if (a.state==='WALKING') { a.state='TYPING'; a.dir='down'; }
          a.animTick += dt;
          if (a.animTick > 0.5) { a.animStep++; a.animTick=0; }
        }
      });

      // ── Draw ──────────────────────────────────────────────────────────────
      ctx.clearRect(0,0,W,H);
      drawRoom(ctx, W, H, assets||{}, P);

      // Desks (Z-sorted by home Y)
      deskPos.map((dp,i)=>({i,y:dp.y})).sort((a,b)=>a.y-b.y)
        .forEach(({i}) => drawDesk(ctx, deskPos[i].x, deskPos[i].y, i, assets||{}, P));

      // Characters (Z-sorted by current Y)
      const zOrder = agents.map((a,i)=>({i,y:a.y})).sort((a,b)=>a.y-b.y);
      zOrder.forEach(({i}) => {
        const a = agents[i], ag = DR_AGENTS[i];
        const sp = assets?.charSprites?.[i] || null;
        const fr = getFrame(sp, a.dir, a.state, a.animStep);
        if (fr) {
          drawSpriteFrame(ctx, fr,
            Math.round(a.x - (CHAR_W*P)/2),
            Math.round(a.y - CHAR_H*P),
            P);
        } else {
          // Fallback coloured block
          ctx.fillStyle = ag.accent+'99';
          ctx.fillRect(Math.round(a.x-P*4), Math.round(a.y-P*14), P*8, P*14);
          ctx.fillStyle = ag.accent+'44';
          ctx.fillRect(Math.round(a.x-P*3), Math.round(a.y-P*20), P*6, P*6);
        }
        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = `${Math.max(6,P*3)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(ag.label, Math.round(a.x), Math.round(a.y+P));
      });

      // Fetcher agent — drawn above desks but below overlays
      const ft = stateRef.current?.fetcherRef;
      if (ft && ft.visible) {
        const fsp = assets?.fetcherSprite || null;
        const ffr = getFrame(fsp, ft.dir, ft.state, ft.animStep);
        if (ffr) {
          drawSpriteFrame(ctx, ffr, Math.round(ft.x-(CHAR_W*P)/2), Math.round(ft.y-CHAR_H*P), P);
        } else {
          ctx.fillStyle = FETCHER_AGENT.accent + '99';
          ctx.fillRect(Math.round(ft.x-P*4), Math.round(ft.y-P*14), P*8, P*14);
          ctx.fillStyle = FETCHER_AGENT.accent + '44';
          ctx.fillRect(Math.round(ft.x-P*3), Math.round(ft.y-P*20), P*6, P*6);
        }
        ctx.fillStyle = FETCHER_AGENT.accent;
        ctx.font = `${Math.max(6,P*3)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(FETCHER_AGENT.label, Math.round(ft.x), Math.round(ft.y+P));
        // Animate fetcher movement
        const fdx = ft.tx-ft.x, fdy = ft.ty-ft.y, fdist = Math.hypot(fdx,fdy);
        if (fdist > P*0.5) {
          const fstep = Math.min(P*80*dt, fdist);
          ft.x += (fdx/fdist)*fstep; ft.y += (fdy/fdist)*fstep;
          ft.state = 'WALKING';
          ft.animTick += dt;
          if (ft.animTick > 0.12) { ft.animStep++; ft.animTick=0; }
          ft.dir = Math.abs(fdx)>Math.abs(fdy)?(fdx>0?'right':'left'):(fdy>0?'down':'up');
        } else {
          ft.x=ft.tx; ft.y=ft.ty;
          if (ft.state==='WALKING') { ft.state='TYPING'; ft.dir='down'; }
          ft.animTick += dt;
          if (ft.animTick > 0.5) { ft.animStep++; ft.animTick=0; }
        }
      }

      // Overlays (bubbles, deltas) — always on top
      zOrder.forEach(({i}) => {
        const a = agents[i];
        if (a.bubble) {
          const age = simT-a.bubble.t;
          const alpha = age<0.2?age/0.2:age<2.8?1:Math.max(0,1-(age-2.8)/0.9);
          drawBubble(ctx, Math.round(a.x), Math.round(a.y), a.bubble.text, a.bubble.color, alpha, P);
          if (alpha<=0) a.bubble=null;
        }
        if (a.delta) {
          const age = simT-a.delta.t;
          const floatY = Math.round(a.y - CHAR_H*P - age*P*14);
          const alpha = age<0.15?age/0.15:age<1.4?1:Math.max(0,1-(age-1.4)/0.5);
          drawDelta(ctx, Math.round(a.x), floatY, a.delta.text, a.delta.color, alpha, P);
          if (alpha<=0) a.delta=null;
        }
      });

      // Fetcher bubble overlay
      if (ft && ft.visible && ft.bubble) {
        const age = simT - ft.bubble.t;
        const alpha = age<0.2?age/0.2:age<2.5?1:Math.max(0,1-(age-2.5)/0.8);
        drawBubble(ctx, Math.round(ft.x), Math.round(ft.y), ft.bubble.text, ft.bubble.color, alpha, P);
        if (alpha<=0) ft.bubble=null;
      }

      // ── HUD overlay — bottom of canvas ──────────────────────────────────
      const el = elapsedRef.current, tk = tickerRef.current;
      const mins2 = Math.floor(el/60), secs2 = el%60;
      const elFmt2 = mins2>0 ? `${mins2}m ${secs2<10?'0':''}${secs2}s` : `${el}s`;
      const live2 = liveRef.current;
      const isRun2 = isRunningRef.current;
      const hasDossierEv = live2 && live2.some(e => e.type==='DOSSIER_START' || e.type==='FETCH_DONE');
      const hasDebateEv  = live2 && live2.some(e => e.type==='R1_SCORE' || e.type==='START');
      const line1 = tk
        ? (hasDebateEv  ? `DEBATING ${tk.toUpperCase()} · ${elFmt2}`
          : hasDossierEv ? `BUILDING DOSSIER · ${tk.toUpperCase()}`
          : isRun2       ? `COMPILING DOSSIER · ${tk.toUpperCase()}`
          : `AGENTS IN SESSION · ${elFmt2}`)
        : `AGENTS IN SESSION · ${elFmt2}`;
      const line2 = (isRun2 && !hasDebateEv) ? 'FETCHING DATA · SOVEREIGN DD' : '5 AGENTS · SOVEREIGN DD';
      const hudH = 26;
      ctx.fillStyle = 'rgba(9,9,11,0.72)';
      ctx.fillRect(0, H - hudH, W, hudH);
      ctx.font = `${Math.max(8,P*4)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#71717a';
      ctx.fillText(line1, W/2, H - hudH + 8);
      ctx.font = `${Math.max(7,P*3)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#52525b';
      ctx.fillText(line2, W/2, H - hudH + 20);

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [assetsReady, ddData, canvasSize]);

  return (
    <div ref={wrapRef} style={{ width:'100%', height:'100%', minHeight:0 }}>
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        style={{ imageRendering:'pixelated', display:'block', width:'100%' }}
      />
    </div>
  );
}

window.DebateRoom = DebateRoom;

})();
