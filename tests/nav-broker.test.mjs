// Broker NAV history — endpoint + series math regression tests.
// Run: node tests/nav-broker.test.mjs
//
// Locks the 2026-07-11 contract:
//   - /api/dd/nav-broker is broker-scoped: a POSTed broker fully replaces its
//     bundle, absent brokers are never touched
//   - re-POSTing identical content skips the KV write (kvWrites 0)
//   - nav-history's combined series starts at the LATEST broker inception
//     (no fake NAV jumps), forward-fills per-broker calendar gaps, and TWR
//     strips deposits/withdrawals out of return

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workers globals expected by the modules under test.
globalThis.caches = {
  default: { match: async () => undefined, put: async () => {}, delete: async () => true },
};

const { onRequestPost } =
  await import(pathToFileURL(join(__dirname, "..", "functions", "api", "dd", "nav-broker.js")).href);
const { combineBrokerNav, twrPct, alignCloses } =
  await import(pathToFileURL(join(__dirname, "..", "functions", "api", "nav-history.js")).href);

function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ops = { put: 0, get: 0 };
  return {
    store, ops,
    async get(k, type) {
      ops.get++;
      const v = store.has(k) ? store.get(k) : null;
      return type === "json" && typeof v === "string" ? JSON.parse(v) : v;
    },
    async put(k, v) { ops.put++; store.set(k, v); },
  };
}

function ctx(kv, body, bearer = "s3cret") {
  return {
    env: { DD_UPLOAD_SECRET: "s3cret", DD_KV: kv },
    request: {
      url: "https://eye.example/api/dd/nav-broker",
      headers: { get: k => (k === "Authorization" ? `Bearer ${bearer}` : null) },
      json: async () => body,
    },
    waitUntil: () => {},
  };
}

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

const IBKR = {
  navs: [{ date: "2026-07-09", nav: 68000.5 }, { date: "2026-07-10", nav: 68500 }],
  flows: [{ date: "2026-07-09", amount: 1000 }],
  income: [{ date: "2026-06-20", amount: 12.81, type: "Dividends", ticker: "goog" }],
  twr: 18.42,
};

// ── 1. auth ────────────────────────────────────────────────────────────────────
{
  const kv = mockKV();
  const res = await onRequestPost(ctx(kv, { brokers: { IBKR } }, "wrong"));
  check("wrong bearer -> 401", res.status === 401);
  check("no KV ops on auth failure", kv.ops.put === 0);
}

// ── 2. broker-scoped merge: absent broker untouched, POSTed broker replaced ───
{
  const kv = mockKV({
    "nav:broker:v1": JSON.stringify({
      Tiger: { navs: [{ date: "2026-07-01", nav: 65000 }], flows: [], income: [], twr: null, updated: "x" },
      IBKR:  { navs: [{ date: "2026-01-01", nav: 1 }], flows: [], income: [], twr: null, updated: "x" },
    }),
  });
  const res = await onRequestPost(ctx(kv, { brokers: { IBKR } }));
  const body = await res.json();
  const doc = JSON.parse(kv.store.get("nav:broker:v1"));
  check("upload ok + kvWrites reported", body.ok === true && body.kvWrites === 1);
  check("absent Tiger untouched", doc.Tiger.navs[0].nav === 65000, JSON.stringify(doc.Tiger));
  check("IBKR replaced wholesale (old point gone)",
        doc.IBKR.navs.length === 2 && doc.IBKR.navs[0].date === "2026-07-09",
        JSON.stringify(doc.IBKR.navs));
  check("twr stored", doc.IBKR.twr === 18.42);
  check("income ticker uppercased", doc.IBKR.income[0].ticker === "GOOG");
}

// ── 2b. twr null is preserved (Number(null) === 0 must not fake a 0% TWR) ─────
{
  const kv = mockKV();
  await onRequestPost(ctx(kv, { brokers: { IBKR: {
    navs: [{ date: "2026-07-09", nav: 100 }], twr: null,
  } } }));
  const doc = JSON.parse(kv.store.get("nav:broker:v1"));
  check("null twr stays null (not 0)", doc.IBKR.twr === null, `twr=${doc.IBKR.twr}`);
}

// ── 3. idempotent re-POST skips the write ──────────────────────────────────────
{
  const kv = mockKV();
  await onRequestPost(ctx(kv, { brokers: { IBKR } }));
  const putsAfterFirst = kv.ops.put;
  const res2 = await onRequestPost(ctx(kv, { brokers: { IBKR } }));
  const body2 = await res2.json();
  check("identical re-POST skips KV write", kv.ops.put === putsAfterFirst && body2.kvWrites === 0,
        `puts=${kv.ops.put} kvWrites=${body2.kvWrites}`);
}

// ── 4. validation ──────────────────────────────────────────────────────────────
{
  const kv = mockKV();
  const bad = async body => (await onRequestPost(ctx(kv, body))).status;
  check("unknown broker -> 400", await bad({ brokers: { Robinhood: IBKR } }) === 400);
  check("bad date -> 400",
        await bad({ brokers: { IBKR: { navs: [{ date: "07/09/2026", nav: 1 }] } } }) === 400);
  check("non-finite nav -> 400",
        await bad({ brokers: { IBKR: { navs: [{ date: "2026-07-09", nav: "abc" }] } } }) === 400);
  check("empty navs -> 400", await bad({ brokers: { IBKR: { navs: [] } } }) === 400);
  check("no brokers -> 400", await bad({ brokers: {} }) === 400);
  check("nothing written on validation failures", kv.ops.put === 0);
}

// ── 5. navs dedup by date (last wins) + chronological sort ─────────────────────
{
  const kv = mockKV();
  await onRequestPost(ctx(kv, { brokers: { IBKR: {
    navs: [{ date: "2026-07-10", nav: 2 }, { date: "2026-07-09", nav: 1 },
           { date: "2026-07-10", nav: 3 }],
  } } }));
  const doc = JSON.parse(kv.store.get("nav:broker:v1"));
  check("navs sorted + deduped last-wins",
        doc.IBKR.navs.length === 2 && doc.IBKR.navs[1].nav === 3,
        JSON.stringify(doc.IBKR.navs));
}

// ── 6. combineBrokerNav: common span + forward-fill + flow scoping ─────────────
{
  const doc = {
    Tiger: { // reports calendar days from way back
      navs: [{ date: "2026-07-01", nav: 100 }, { date: "2026-07-04", nav: 110 },
             { date: "2026-07-05", nav: 112 }, { date: "2026-07-06", nav: 115 }],
      flows: [{ date: "2026-07-01", amount: 999 },   // before common span → dropped
              { date: "2026-07-06", amount: 10 }],
      income: [],
    },
    IBKR: { // starts later, business days only
      navs: [{ date: "2026-07-04", nav: 200 }, { date: "2026-07-06", nav: 210 }],
      flows: [{ date: "2026-07-06", amount: 5 }],
      income: [{ date: "2026-07-05", amount: 1.5, type: "Dividends", ticker: "GOOG" }],
    },
  };
  const c = combineBrokerNav(doc);
  check("series starts at latest broker inception", c.dates[0] === "2026-07-04", c.dates.join(","));
  check("weekend gap forward-fills the sparse broker",
        c.nav[1] === 312, `nav=${c.nav.join(",")}`);   // 112 + carried 200
  check("both-broker dates sum directly", c.nav[2] === 325, `nav=${c.nav.join(",")}`);
  check("flows summed within span only",
        c.flows.get("2026-07-06") === 15 && !c.flows.has("2026-07-01"),
        JSON.stringify([...c.flows]));
  check("income tagged with broker", c.income[0].broker === "IBKR");
  check("empty doc -> null", combineBrokerNav({}) === null && combineBrokerNav(null) === null);
}

// ── 7. twrPct: deposits are not returns ────────────────────────────────────────
{
  const flows = new Map([["2026-07-02", 100]]);
  const twr = twrPct(["2026-07-01", "2026-07-02"], [100, 210], flows);
  check("deposit stripped from return", Math.abs(twr - 10) < 1e-9, `twr=${twr}`);
  const plain = twrPct(["2026-07-01", "2026-07-02"], [100, 105], new Map());
  check("no-flow return is plain return", Math.abs(plain - 5) < 1e-9, `twr=${plain}`);
  const guarded = twrPct(["a", "b"], [0, 100], new Map());
  check("zero-prev guarded", Number.isFinite(guarded), `twr=${guarded}`);
}

// ── 8. alignCloses: forward-fill + leading backfill ────────────────────────────
{
  const closes = new Map([["2026-07-03", 50], ["2026-07-06", 52]]);
  const out = alignCloses(["2026-07-02", "2026-07-04", "2026-07-06"], closes);
  check("leading date backfills first close", out[0] === 50, out.join(","));
  check("gap forward-fills", out[1] === 50 && out[2] === 52, out.join(","));
  check("empty closes -> null", alignCloses(["2026-07-02"], new Map()) === null);
}

console.log(failed === 0 ? "\nALL NAV-BROKER TESTS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
