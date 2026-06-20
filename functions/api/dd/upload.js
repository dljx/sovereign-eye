async function purgeCdnCache(request, writtenKeys) {
  const origin = new URL(request.url).origin;
  const cache = caches.default;
  const urls = writtenKeys
    .filter(k => k === "dd:index" || k === "dd:scouts" || k === "dd:gems" || (k.startsWith("dd:") && !k.startsWith("dd:live:")))
    .map(k => {
      if (k === "dd:index") return `${origin}/api/dd/index`;
      if (k === "dd:scouts") return `${origin}/api/dd/scouts`;
      if (k === "dd:gems") return `${origin}/api/dd/gems`;
      return `${origin}/api/dd/${k.slice(3).toLowerCase()}`;
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

  const { results = [], index, scouts, gems, watchlist, reconcile_remove } = body;
  const written = [];
  const failed = [];

  // Write individual ticker results + clean up live event keys
  for (const { key, value } of results) {
    try {
      await context.env.DD_KV.put(key, JSON.stringify(value));
      written.push(key);
      // Delete the live event stream now that final result is stored
      if (key.startsWith("dd:")) {
        const ticker = key.slice(3); // "dd:GOOG" → "GOOG"
        await context.env.DD_KV.delete(`dd:live:${ticker}`).catch(() => {});
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
      written.push("dd:index");
    } catch (e) {
      failed.push({ key: "dd:index", error: e.message });
    }
  }

  // Merge new scouts into the existing accumulated list (never replace wholesale).
  // Dedup by ticker — newest entry wins. Cap at 100 to bound KV value size.
  if (Array.isArray(scouts) && scouts.length > 0) {
    try {
      let existing = [];
      const raw = await context.env.DD_KV.get("dd:scouts");
      if (raw) {
        try { existing = JSON.parse(raw); } catch {}
      }
      // Build a map keyed by ticker; new entries overwrite older ones
      const map = new Map((Array.isArray(existing) ? existing : []).map(s => [s.ticker, s]));
      for (const s of scouts) map.set(s.ticker, s);
      // Sort by score descending, cap at 100
      const merged = [...map.values()].sort((a, b) => b.score - a.score).slice(0, 100);
      await context.env.DD_KV.put("dd:scouts", JSON.stringify(merged));
      written.push("dd:scouts");
    } catch (e) {
      failed.push({ key: "dd:scouts", error: e.message });
    }
  }

  // Merge new gems into the accumulated dd:gems list — same dedup-by-ticker /
  // sort-by-score / cap-100 contract as dd:scouts above.
  if (Array.isArray(gems) && gems.length > 0) {
    try {
      let existing = [];
      const raw = await context.env.DD_KV.get("dd:gems");
      if (raw) {
        try { existing = JSON.parse(raw); } catch {}
      }
      const map = new Map((Array.isArray(existing) ? existing : []).map(s => [s.ticker, s]));
      for (const s of gems) map.set(s.ticker, s);
      const merged = [...map.values()].sort((a, b) => b.score - a.score).slice(0, 100);
      await context.env.DD_KV.put("dd:gems", JSON.stringify(merged));
      written.push("dd:gems");
    } catch (e) {
      failed.push({ key: "dd:gems", error: e.message });
    }
  }

  // Merge new "Under Review" items into dd:watchlist — BUYs that crossed the
  // threshold but failed the confirmation gate. Same dedup/sort/cap as scouts.
  if (Array.isArray(watchlist) && watchlist.length > 0) {
    try {
      let existing = [];
      const raw = await context.env.DD_KV.get("dd:watchlist");
      if (raw) {
        try { existing = JSON.parse(raw); } catch {}
      }
      const map = new Map((Array.isArray(existing) ? existing : []).map(s => [s.ticker, s]));
      for (const s of watchlist) map.set(s.ticker, s);
      const merged = [...map.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 100);
      await context.env.DD_KV.put("dd:watchlist", JSON.stringify(merged));
      written.push("dd:watchlist");
    } catch (e) {
      failed.push({ key: "dd:watchlist", error: e.message });
    }
  }

  // Cross-board reconciliation so each ticker lives on exactly ONE board.
  // Runs AFTER the upserts so a same-run qualifying result is never undone.
  //   - dropped below threshold (reconcile_remove)     → off scouts + gems + watchlist
  //   - newly under review (this run's watchlist)        → off scouts + gems
  //   - newly confirmed (this run's scouts/gems)         → off watchlist (promoted)
  const _up = arr => (Array.isArray(arr) ? arr : []).map(s => String(s.ticker ?? s).toUpperCase());
  const baseRemove       = _up(reconcile_remove);
  const confirmedTickers = [..._up(scouts), ..._up(gems)];
  const watchTickers     = _up(watchlist);
  const dropFromBoards = new Set([...baseRemove, ...watchTickers]);     // off scouts/gems
  const dropFromWatch  = new Set([...baseRemove, ...confirmedTickers]); // off watchlist

  async function pruneKey(kvKey, dropSet) {
    if (dropSet.size === 0) return;
    try {
      const raw = await context.env.DD_KV.get(kvKey);
      if (!raw) return;
      let list;
      try { list = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(list)) return;
      const filtered = list.filter(s => !dropSet.has(String(s.ticker || "").toUpperCase()));
      if (filtered.length !== list.length) {
        await context.env.DD_KV.put(kvKey, JSON.stringify(filtered));
        if (!written.includes(kvKey)) written.push(kvKey);
      }
    } catch (e) {
      failed.push({ key: `${kvKey} (reconcile)`, error: e.message });
    }
  }

  await pruneKey("dd:scouts", dropFromBoards);
  await pruneKey("dd:gems", dropFromBoards);
  await pruneKey("dd:watchlist", dropFromWatch);

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
    written.push("dd:meta");
  } catch (e) {
    failed.push({ key: "dd:meta", error: e.message });
  }

  return Response.json({
    ok: failed.length === 0,
    written,
    failed,
  });
}
