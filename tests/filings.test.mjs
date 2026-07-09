// /api/filings on the EDGAR source: atom parsing, meaningful-form filtering,
// the raised 20-ticker cap, and TLDR-less caching. Locks the 2026-07-09
// switch away from Finnhub (whose filings feed lagged EDGAR by ~a week and
// whose GOOG mapping is frozen in 2016).
// Run: node tests/filings.test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  [${detail}]`}`);
}

const tmp = mkdtempSync(join(tmpdir(), "se-filings-"));
writeFileSync(join(tmp, "package.json"), '{"type":"module"}');
for (const f of ["filings.js", "_util.js", "_gemini.js"]) {
  writeFileSync(join(tmp, f), readFileSync(join(__dirname, "..", "functions", "api", f)));
}
const { onRequestGet, parseAtomFilings } = await import(pathToFileURL(join(tmp, "filings.js")).href);

// ── Atom parsing ────────────────────────────────────────────────────────────────
{
  const xml = `<feed><entry>
    <content type="text/xml">
      <filing-date>2026-07-07</filing-date>
      <filing-href>https://www.sec.gov/Archives/edgar/data/1616533/000161653326000079/0001616533-26-000079-index.htm</filing-href>
      <filing-type>10-Q</filing-type>
    </content></entry><entry>
    <content type="text/xml">
      <filing-date>2026-07-06</filing-date>
      <filing-href>https://x/2-index.htm</filing-href>
      <filing-type>4</filing-type>
    </content></entry></feed>`;
  const rows = parseAtomFilings(xml);
  check("atom rows parsed", rows.length === 2, JSON.stringify(rows));
  check("form + date + href extracted", rows[0].form === "10-Q" && rows[0].filedDate === "2026-07-07" && rows[0].url.includes("-index.htm"));
}

// ── Endpoint with mocked EDGAR ─────────────────────────────────────────────────
function mockKV() {
  const store = new Map();
  return {
    store,
    async get(k, _t) { const v = store.get(k); return v ? JSON.parse(v) : null; },
    async put(k, v, _o) { store.set(k, v); },
  };
}

const ATOM = (form, date) => `<feed><entry><content>
  <filing-date>${date}</filing-date>
  <filing-href>https://www.sec.gov/Archives/edgar/data/1/2/3-index.htm</filing-href>
  <filing-type>${form}</filing-type>
</content></entry></feed>`;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("company_tickers.json")) {
    return new Response(JSON.stringify({
      0: { cik_str: 1616533, ticker: "PENG", title: "Penguin Solutions" },
      1: { cik_str: 1018724, ticker: "AMZN", title: "Amazon" },
    }), { status: 200 });
  }
  if (u.includes("browse-edgar")) {
    return new Response(u.includes("1616533") ? ATOM("10-Q", "2026-07-07") : ATOM("4", "2026-07-06"), { status: 200 });
  }
  if (u.includes("index.json")) return new Response(JSON.stringify({ directory: { item: [{ name: "doc.htm" }] } }), { status: 200 });
  if (u.includes("doc.htm")) return new Response("<html>Item 2 Results of operations revenue grew</html>", { status: 200 });
  if (u.includes("generativelanguage")) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"tldr":"Quarterly results filed","sent":"neutral"}]' }] } }] }), { status: 200 });
  }
  return new Response("not mocked: " + u, { status: 404 });
};

{
  const env = { DD_KV: mockKV(), GEMINI_API_KEY: "gk" };
  const res = await onRequestGet({ request: { url: "https://x/api/filings?tickers=PENG,AMZN,PENG" }, env });
  const items = await res.json();
  check("meaningful filings returned", items.length === 1, JSON.stringify(items));
  check("PENG 10-Q of 2026-07-07 present", items[0]?.tk === "PENG" && items[0]?.form === "10-Q" && items[0]?.filedDate === "2026-07-07");
  check("insider form 4 excluded", !items.some(i => i.form === "4"));
  check("tldr attached", items[0]?.tldr === "Quarterly results filed");
  check("result cached", [...env.DD_KV.store.keys()].some(k => k.startsWith("sec:filings:v13")));
  check("cik map cached", [...env.DD_KV.store.keys()].some(k => k.startsWith("sec:ciks:v1")));
}

// 20-ticker cap (was 10): 12 tickers must ALL be looked up.
{
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("company_tickers.json")) {
      const list = {};
      for (let i = 0; i < 12; i++) list[i] = { cik_str: 100 + i, ticker: "T" + i, title: "t" };
      return new Response(JSON.stringify(list), { status: 200 });
    }
    if (u.includes("browse-edgar")) { asked.push(u); return new Response(ATOM("8-K", "2026-07-05"), { status: 200 }); }
    return realFetch(url);
  };
  const env = { DD_KV: mockKV() }; // no Gemini — TLDR-less path
  const qs = Array.from({ length: 12 }, (_, i) => "T" + i).join(",");
  const res = await onRequestGet({ request: { url: `https://x/api/filings?tickers=${qs}` }, env });
  const items = await res.json();
  check("all 12 tickers queried (old cap was 10)", asked.length === 12, String(asked.length));
  check("top-12 overall limit holds", items.length === 12);
  check("TLDR-less result still cached", [...env.DD_KV.store.keys()].some(k => k.startsWith("sec:filings:v13")));
  globalThis.fetch = realFetch;
}

console.log(failed ? `\n${failed} FILINGS TEST(S) FAILED` : "\nALL FILINGS TESTS PASSED");
process.exit(failed ? 1 : 0);
