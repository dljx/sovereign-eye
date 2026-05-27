/* global React, window, Icon, SrcPill, fmtUSD */
(function () {
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// =============================================================
// IMPORT MODAL — real Gemini Vision parse + diff review
// =============================================================
function ImportModal({ open, positions, onClose, onSave }) {
  const [step, setStep] = useState('drop');    // drop | parse | diff | saving | saved | error
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState({});
  const [diff, setDiff] = useState(null);
  const [broker, setBroker] = useState('');
  const [partial, setPartial] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const fileRef = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep('drop');
      setProgress(0);
      setSelected({});
      setDiff(null);
      setIncoming(null);
      setErrMsg('');
    }
  }, [open]);

  // Compute diff between current positions and incoming
  const computeDiff = useCallback((current, inc) => {
    const curMap = new Map((current || []).map(p => [p.ticker, p]));
    const incMap = new Map((inc || []).map(p => [p.ticker, p]));
    const adds = [], upds = [], rems = [];
    inc.forEach(p => {
      if (!curMap.has(p.ticker)) {
        adds.push({ kind: 'add', _key: 'add-' + p.ticker, ...p });
      } else {
        const e = curMap.get(p.ticker);
        if (Math.abs(e.qty - p.qty) > 0.001 || Math.abs((e.avg || 0) - p.avg) > 0.01) {
          upds.push({ kind: 'upd', _key: 'upd-' + p.ticker, ...p, oldQty: e.qty, oldAvg: e.avg || 0 });
        }
      }
    });
    current.forEach(p => {
      if (!incMap.has(p.ticker)) {
        rems.push({ kind: 'rem', _key: 'rem-' + p.ticker, ...p });
      }
    });
    return { adds, upds, rems };
  }, []);

  // Parse file via Gemini
  const parseFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setStep('parse');
    setProgress(0);
    setErrMsg('');

    // Animate progress bar while waiting for API
    let prog = 0;
    const progTimer = setInterval(() => {
      prog = Math.min(prog + 4 + Math.random() * 5, 90);
      setProgress(prog);
    }, 200);

    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const r = await fetch('/api/portfolio/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: base64, mimeType: file.type || 'image/jpeg' }),
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw new Error(result.error || `HTTP ${r.status}`);

      clearInterval(progTimer);
      setProgress(100);

      const d = computeDiff(positions || [], result.positions || []);
      setIncoming(result.positions || []);
      setDiff(d);
      setBroker(result.broker || 'Unknown');
      setPartial(result.partial || false);

      // Default: adds + updates selected, removals NOT selected
      const sel = {};
      d.adds.forEach(r => { sel[r._key] = true; });
      d.upds.forEach(r => { sel[r._key] = true; });
      d.rems.forEach(r => { sel[r._key] = false; });
      setSelected(sel);

      setTimeout(() => setStep('diff'), 400);
    } catch (e) {
      clearInterval(progTimer);
      setErrMsg(e.message || 'Parse failed');
      setStep('error');
    }
  }, [positions, computeDiff]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  // Save confirmed changes
  const save = useCallback(async () => {
    if (!diff || !incoming) return;
    setStep('saving');
    const curMap = new Map((positions || []).map(p => [p.ticker, p]));

    diff.adds.forEach(p => {
      if (selected[p._key]) curMap.set(p.ticker, { ...p });
    });
    diff.upds.forEach(p => {
      if (selected[p._key]) {
        const ex = curMap.get(p.ticker) || {};
        curMap.set(p.ticker, {
          ...ex, ...p,
          sector:   p.sector   || ex.sector   || '',
          industry: p.industry || ex.industry || '',
        });
      }
    });
    diff.rems.forEach(p => {
      if (selected[p._key]) curMap.delete(p.ticker);
    });

    const merged = [...curMap.values()];
    try {
      const r = await fetch('/api/positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!r.ok) throw new Error(`Save failed HTTP ${r.status}`);
      onSave && onSave(merged.map(p => ({ ...p, avg: p.avg ?? p.avgCost ?? 0 })));
      setStep('saved');
      setTimeout(onClose, 1800);
    } catch (e) {
      setErrMsg(e.message);
      setStep('error');
    }
  }, [diff, incoming, positions, selected, onSave, onClose]);

  const allRows = useMemo(() => diff ? [...diff.adds, ...diff.upds, ...diff.rems] : [], [diff]);
  const checkedCount = Object.values(selected).filter(Boolean).length;

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="upload" size={16} />
          <div className="modal-title">Import Portfolio from Screenshot</div>
          <div style={{ flex: 1 }} />
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em' }}>
            {step === 'drop'   && 'STEP 1 / 3'}
            {step === 'parse'  && 'STEP 2 / 3'}
            {step === 'diff'   && 'STEP 3 / 3'}
            {(step === 'saving' || step === 'saved') && 'SAVING'}
            {step === 'error'  && 'ERROR'}
          </div>
          <button className="btn-icon" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>

        <div className="modal-body">

          {/* STEP 1 — Drop zone */}
          {step === 'drop' && (
            <>
              <div
                className={`dropzone ${drag ? 'drag' : ''}`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => parseFile(e.target.files[0])} />
                <div className="dropzone-icon"><Icon name="image" size={22} /></div>
                <div className="dropzone-title">Drop a brokerage screenshot</div>
                <div className="dropzone-sub">PNG, JPG, WEBP — full screen or window capture</div>
                <div className="dropzone-brokers">
                  <span className="broker-tag ibkr">IBKR</span>
                  <span className="broker-tag tiger">TIGER</span>
                  <span className="broker-tag">SCHWAB</span>
                  <span className="broker-tag">FIDELITY</span>
                </div>
              </div>
              <div style={{ marginTop: 18, padding: 12, background: 'var(--bg-2)', border: '1px solid var(--border-1)' }}>
                <div className="mono uppercase" style={{ fontSize: 9, color: 'var(--fg-3)', marginBottom: 8 }}>How it works</div>
                <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.7 }}>
                  <li>Drop a screenshot of your positions panel from any broker.</li>
                  <li>Gemini Vision extracts <span className="mono">ticker, qty, avg cost</span> per row.</li>
                  <li>We diff against your saved portfolio and show <span className="pos">ADDS</span>, <span className="warn">UPDATES</span>, and <span className="neg">REMOVALS</span>.</li>
                  <li>You confirm exactly which changes to apply — nothing is auto-saved.</li>
                </ol>
              </div>
            </>
          )}

          {/* STEP 2 — Parsing */}
          {step === 'parse' && (
            <div style={{ padding: '40px 0' }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <Icon name="image" size={32} />
              </div>
              <div className="parse-status" style={{ justifyContent: 'center' }}>
                <div className="parse-spinner" />
                <div>
                  {progress < 30  && 'OCR pass — extracting ticker grid…'}
                  {progress >= 30 && progress < 65 && 'Vision pass — reading qty / avg cost…'}
                  {progress >= 65 && progress < 90 && 'Reconciling against KV portfolio…'}
                  {progress >= 90 && 'Computing diff…'}
                </div>
              </div>
              <div style={{ maxWidth: 480, margin: '12px auto 0' }}>
                <div style={{ height: 3, background: 'var(--bg-3)', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', inset: '0 auto 0 0',
                    width: `${Math.min(100, progress)}%`,
                    background: 'linear-gradient(90deg, var(--acc), var(--acc-2))',
                    transition: 'width 200ms',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)' }}>
                  <span>GEMINI VISION · PARSING</span>
                  <span>{Math.min(100, Math.round(progress))}%</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — Diff review */}
          {step === 'diff' && diff && (
            <>
              {partial && (
                <div style={{ padding: '8px 12px', background: 'var(--warn-dim, #f59e0b22)', border: '1px solid var(--warn,#f59e0b)', marginBottom: 12, fontSize: 12 }}>
                  ⚠ PARTIAL SCREENSHOT — removals are unchecked by default. Only check removals you have confirmed as sold.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-0)' }}>
                    {allRows.length} changes detected
                  </div>
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                    Source: {broker} · Parsed {incoming?.length || 0} positions
                  </div>
                </div>
                <SrcPill src="live" />
              </div>

              <div className="diff-summary">
                <div className="adds">+ {diff.adds.length} adds</div>
                <div className="upds">~ {diff.upds.length} updates</div>
                <div className="rems">− {diff.rems.length} removals</div>
              </div>

              <div className="diff-list">
                <div className="diff-row" style={{ background: 'var(--bg-2)', fontSize: 9, letterSpacing: '0.16em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>
                  <span style={{ textAlign: 'center' }}>·</span>
                  <span>Ticker</span>
                  <span>Change</span>
                  <span style={{ textAlign: 'right' }}>Qty</span>
                  <span style={{ textAlign: 'right' }}>Avg</span>
                </div>
                {allRows.map(r => (
                  <label className={`diff-row ${r.kind}`} key={r._key}>
                    <input type="checkbox" checked={!!selected[r._key]}
                      onChange={e => setSelected(s => ({ ...s, [r._key]: e.target.checked }))} />
                    <span className="diff-tk">{r.ticker}</span>
                    <span className="diff-change">
                      {r.kind === 'add' && (
                        <span><span className="diff-marker" style={{ display: 'inline-block', width: 12 }}>+</span> Add new position · {r.name}</span>
                      )}
                      {r.kind === 'upd' && (
                        <span>
                          <span className="diff-marker" style={{ display: 'inline-block', width: 12 }}>~</span>
                          {r.oldQty !== r.qty && <>qty {r.oldQty} <span className="arrow">→</span> {r.qty}</>}
                          {r.oldQty !== r.qty && Math.abs(r.oldAvg - r.avg) > 0.01 && ' · '}
                          {Math.abs(r.oldAvg - r.avg) > 0.01 && (
                            <>avg <span className="old-val">{fmtUSD(r.oldAvg)}</span> <span className="arrow">→</span> <span className="new-val">{fmtUSD(r.avg)}</span></>
                          )}
                        </span>
                      )}
                      {r.kind === 'rem' && (
                        <span><span className="diff-marker" style={{ display: 'inline-block', width: 12 }}>−</span> Remove from portfolio · {r.name}</span>
                      )}
                    </span>
                    <span style={{ textAlign: 'right' }}>{r.qty != null ? r.qty : ''}</span>
                    <span style={{ textAlign: 'right' }}>{r.avg != null ? fmtUSD(r.avg) : ''}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {/* Saving */}
          {step === 'saving' && (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div className="parse-status" style={{ justifyContent: 'center' }}>
                <div className="parse-spinner" />
                <div>Saving to KV…</div>
              </div>
            </div>
          )}

          {/* Saved */}
          {step === 'saved' && (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div className="mono pos" style={{ fontSize: 13, letterSpacing: '0.1em' }}>✓ SAVED — KV synced</div>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div className="mono" style={{ color: 'var(--neg)', fontSize: 12, marginBottom: 16 }}>ERROR: {errMsg}</div>
            </div>
          )}

        </div>

        <div className="modal-footer">
          {step === 'drop' && (
            <>
              <span className="mono dim" style={{ fontSize: 11 }}>Image sent to Gemini Vision API.</span>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>Cancel</button>
            </>
          )}
          {step === 'parse' && (
            <>
              <span className="mono dim" style={{ fontSize: 11 }}>Reading rows…</span>
              <span style={{ flex: 1 }} />
              <button className="btn" disabled>Cancel</button>
            </>
          )}
          {step === 'diff' && (
            <>
              <span className="mono dim" style={{ fontSize: 11 }}>{checkedCount} of {allRows.length} selected</span>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => setStep('drop')}>Back</button>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary btn-lg"
                disabled={checkedCount === 0}
                onClick={save}
              >
                Apply {checkedCount} {checkedCount === 1 ? 'change' : 'changes'}
              </button>
            </>
          )}
          {step === 'error' && (
            <>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={() => setStep('drop')}>Retry</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.ImportModal = ImportModal;
})();
