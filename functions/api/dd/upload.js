async function purgeCdnCache(request, writtenKeys) {
  const origin = new URL(request.url).origin;
  const cache = caches.default;
  const urls = writtenKeys
    .filter(k => k === "dd:index" || k === "dd:scouts" || k === "dd:gems" || (k.startsWith("dd:") && !k.startsWith("dd:live:")))
    .map(k => {
      if (k === "dd:index") return `${origin}/api/dd/index`;
      if (k === "dd:scouts") return `${origin}/api/dd/scouts`;
      if (k === "dd:gems") return `${origin}/api/dd/gems`;
      // Keep the ticker's case: [ticker].js caches under the raw request URL
      // (uppercase, e.g. /api/dd/GOOG) and Request URLs are case-sensitive —
      // lowercasing here made every per-ticker purge miss, serving stale DD
      // panels for up to s-maxage=3600 after each upload.
      return `${origin}/api/dd/${k.slice(3)}`;
    });
  await Promise.allSettled(urls.map(url => cache.delete(new Request(url))));
}

/**
 * POST /api/dd/upload
 * Called by GitHub Actions after analysis completes.
 * Body: { results: [{ key, value }], index: {...}, scouts: [...], gems: [...], scout_history: {...}, scout_notified: {...} }
 * Auth: Authorization: Bearer <DD_UPLOAD_SECRET>
 *
 * Bypasses the Basic-Auth middleware using a dedicated upload secret so
 * the GitHub Action doesn't need Cloudflare API tokens.
 */
export async function onRequestPost(context) {
  // Auth check — use a dedicated secret, not the dashboard password
  const uploadSecret = context.env.DD_UPLOAD_SECRET;
  if (!uploadSecret) {
    return Response.json({ error: "DD_UPLOAD_SECRET not configured" }, { status: 500 });
  }

  const auth = context.request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== uploadSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { results = [], index, scouts, gems, watchlist, reconcile_remove, scoreboard } = body;
  const written = [];
  const failed = [];
  let kvOps = 0; // puts + deletes actually performed (free tier: 1,000/day, shared)

  // Write individual ticker results + clean up live event keys
  for (const { key, value } of results) {
    try {
      await context.env.DD_KV.put(key, JSON.stringify(value));
      kvOps++;
      written.push(key);
      // Delete the live event stream now that the final result is stored — but
      // only when one exists: live keys TTL out on their own (live.js writes
      // with expirationTtl), and the old unconditional delete burned one write-
      // budget op per ticker per upload, mostly on non-existent keys. A read
      // costs against the far larger read budget instead.
      if (key.startsWith("dd:")) {
        const ticker = key.slice(3); // "dd:GOOG" → "GOOG"
        try {
          const live = await context.env.DD_KV.get(`dd:live:${ticker}`);
          if (live !== null) {
            await context.env.DD_KV.delete(`dd:live:${ticker}`);
            kvOps++;
          }
        } catch {}
      }
    } catch (e) {
      failed.push({ key, error: e.message });
    }
  }

  // Merge into the master index (never replace wholesale — a scout-only run
  // POSTs an empty {} index and a manual single-ticker run POSTs one entry;
  // either would otherwise wipe the portfolio's entries).
  if (index && typeof index === "object" && Object.keys(index).length > 0) {
    try {
      let existing = {};
      const raw = await context.env.DD_KV.get("dd:index");
      if (raw) {
        try { existing = JSON.parse(raw) || {}; } catch {}
      }
      await context.env.DD_KV.put("dd:index", JSON.stringify({ ...existing, ...index }));
      kvOps++;
      written.push("dd:index");
    } catch (e) {
      failed.push({ key: "dd:index", error: e.message });
    }
  }

  // Cross-board reconciliation sets, computed BEFORE the merges so each board
  // key is read+merged+pruned+written in ONE pass (merge and prune used to be
  // two separate writes per key — pure write-budget waste). The sets are
  // mutually exclusive with same-run incoming entries by construction
  // (reconcile_remove = below threshold; a ticker routes to either the boards
  // or the watchlist in one run, never both), so single-pass = same result.
  //   - dropped below threshold (reconcile_remove)  → off scouts + gems + watchlist
  //   - newly under review (this run's watchlist)   → off scouts + gems
  //   - newly confirmed (this run's scouts/gems)    → off watchlist (promoted)
  const _up = arr => (Array.isArray(arr) ? arr : []).map(s => String(s.ticker ?? s).toUpperCase());
  const baseRemove       = _up(reconcile_remove);
  const confirmedTickers = [..._up(scouts), ..._up(gems)];
  const watchTickers     = _up(watchlist);
  const dropFromBoards = new Set([...baseRemove, ...watchTickers]);     // off scouts/gems
  const dropFromWatch  = new Set([...baseRemove, ...confirmedTickers]); // off watchlist

  // Boards are accumulators, and a card only otherwise leaves when its ticker
  // happens to be re-analyzed — which stale scout tickers never are. Without an
  // age-out, three retired gate-policy eras piled up on the boards (June
  // pre-gate cards, fail-open UNVERIFIED auto-passes, divergence-rule rejects)
  // until "everything looked rejected or unknown" (found 2026-07-11). A debate
  // verdict is priced on its run-date data; after two weeks it's not a signal.
  const BOARD_MAX_AGE_DAYS = 14;
  const pruneCutoff = Date.now() - BOARD_MAX_AGE_DAYS * 86400000;
  const cardFresh = c => {
    const d = Date.parse(c?.analyzed_at || (c?.verification || {}).checked_at || "");
    // Undated cards are grandfathered: a future stamp regression must degrade
    // to the old keep-forever behavior, never silently wipe the boards.
    return !Number.isFinite(d) || d >= pruneCutoff;
  };

  // Merge incoming entries into an accumulated board list (never replace
  // wholesale), apply the reconciliation drops + age-out, sort by score, cap
  // at 100 — and skip the KV write entirely when the result is byte-identical.
  async function mergeBoard(kvKey, incoming, dropSet) {
    const has = Array.isArray(incoming) && incoming.length > 0;
    if (!has && dropSet.size === 0) return;
    try {
      const raw = await context.env.DD_KV.get(kvKey);
      let existing = [];
      if (raw) { try { existing = JSON.parse(raw) || []; } catch {} }
      // Keyed by upper-cased ticker; entries without a ticker can't be deduped
      // or reconciled — drop them.
      const map = new Map((Array.isArray(existing) ? existing : [])
        .filter(s => s && s.ticker)
        .map(s => [String(s.ticker).toUpperCase(), s]));
      for (const s of (has ? incoming : [])) {
        if (s && s.ticker) map.set(String(s.ticker).toUpperCase(), s);
      }
      for (const t of dropSet) map.delete(t);
      const merged = [...map.values()].filter(cardFresh)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 100);
      const out = JSON.stringify(merged);
      if (out === raw) return; // unchanged — save the write
      await context.env.DD_KV.put(kvKey, out);
      kvOps++;
      written.push(kvKey);
    } catch (e) {
      failed.push({ key: kvKey, error: e.message });
    }
  }

  await mergeBoard("dd:scouts", scouts, dropFromBoards);
  await mergeBoard("dd:gems", gems, dropFromBoards);
  await mergeBoard("dd:watchlist", watchlist, dropFromWatch);

  // Scoreboard snapshot (signal performance vs benchmark, from
  // signal_analysis.py) — replaced wholesale: it's a computed artifact,
  // not an accumulator like the boards above.
  if (scoreboard && typeof scoreboard === "object") {
    try {
      await context.env.DD_KV.put("dd:scoreboard", JSON.stringify(scoreboard));
      kvOps++;
      written.push("dd:scoreboard");
    } catch (e) {
      failed.push({ key: "dd:scoreboard", error: e.message });
    }
  }

  // Persist scout history and notification history for cache-miss recovery in CI.
  // Written as scout:history and scout:notified — fetched by download_history.py
  // when the GitHub Actions cache is cold.
  for (const [field, kvKey] of [
    ["scout_history",  "scout:history"],
    ["scout_notified", "scout:notified"],
    ["gems_history",   "gems:history"],
    ["scout_seen",     "scout:seen"],
  ]) {
    const data = body[field];
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      try {
        await context.env.DD_KV.put(kvKey, JSON.stringify(data));
        kvOps++;
        written.push(kvKey);
      } catch (e) {
        failed.push({ key: kvKey, error: e.message });
      }
    }
  }

  await purgeCdnCache(context.request, written);

  // Heartbeat: record when the screen last uploaded. This is the ONLY reliable
  // signal that the daily cron actually ran — stale dd:scouts/dd:index keys
  // persist indefinitely, so /api/health can't tell a dead cron from a live one
  // by key presence alone. Written AFTER purge (health reads KV directly, so it
  // needs no cache invalidation) and never fails the upload.
  try {
    await context.env.DD_KV.put("dd:meta", JSON.stringify({
      lastUploadAt: new Date().toISOString(),
      keysWritten:  written.length,
      ok:           failed.length === 0,
    }));
    kvOps++;
    written.push("dd:meta");
  } catch (e) {
    failed.push({ key: "dd:meta", error: e.message });
  }

  return Response.json({
    ok: failed.length === 0,
    written,
    failed,
    // KV write-budget observability — upload_kv.py prints this and ops-alerts
    // when a single upload's op count looks like it would blow the daily cap.
    kvWrites: kvOps,
  });
}
