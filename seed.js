// Sovereign Eye — seed / fallback data
// Used when live API calls fail or are loading.

window.SE_SEED = {

  // ── Intelligence Feed (Gemma bullets) — fallback when /api/synthesis is slow/down ──
  intel: {
    catalysts: [
      { tag: "AI INFRA", tagClass: "pos",  text: "<b>AVGO + MRVL</b> custom-silicon wins at hyperscalers are widening: Broadcom XPU revenue tracking $12B annualised; Marvell DPU pipeline extends into 2027 budget cycles." },
      { tag: "POWER",    tagClass: "pos",  text: "<b>VST</b> AI datacenter PPAs now clearing $80+/MWh — 2× Vistra's generation cost basis. Hyperscaler demand outstrips nameplate capacity through 2028 on current build plans." },
      { tag: "CLOUD",    tagClass: "info", text: "<b>AMZN + MSFT</b> AWS and Azure both guiding capex step-ups into 2H; AI inference workloads now the primary capacity driver, not storage." }
    ],
    risks: [
      { tag: "SEMIS",   tagClass: "warn", text: "<b>MU</b> HBM3E yield ramp is the gating variable — qualification slippage at any top-3 hyperscaler shifts the FY27 unit curve meaningfully lower." },
      { tag: "VALUATION",tagClass:"warn", text: "<b>NOW</b> trades at 18× revenue with 30% growth — any miss on net-new ACV in the next 2 prints compresses the multiple faster than the fundamental deterioration." },
      { tag: "SMALL-CAP",tagClass:"warn", text: "<b>PENG</b> AI infra narrative is intact but the micro-cap liquidity premium is real — position sizing should reflect the 4–6× wider bid-ask spread vs the rest of the book." }
    ],
    macro: [
      { tag: "AI CAPEX", tagClass: "info", text: "Hyperscaler capex is tracking +47% YoY in 1H26 — the portfolio's combined AI-infrastructure exposure (AVGO, MRVL, ANET, PENG, AMZN, MSFT) captures the entire supply chain of that spend." },
      { tag: "RATES",    tagClass: "info", text: "10Y–2Y spread at +38 bps and steepening — historically a tailwind for cyclicals; <b>EME</b> and <b>MTZ</b> infrastructure backlog should re-rate on a soft-landing confirmation." },
      { tag: "ENERGY",   tagClass: "warn", text: "Power demand forecasts for AI datacenters are being revised up across all major grid operators — <b>VST</b> is structurally long the outcome regardless of gas vs nuclear mix." }
    ]
  },

  // ── Portfolio News fallback ──
  portfolioNews: [
    { tk: "AVGO",  sev: "pos",  headline: "Broadcom XPU revenue tracking $12B annualised on hyperscaler wins",    src: "Semianalysis", when: "2h" },
    { tk: "MSFT",  sev: "info", headline: "Azure +33% cc; AI services contributing 9pts to growth",                 src: "MSFT IR",    when: "3h" },
    { tk: "AMZN",  sev: "pos",  headline: "AWS +21% cc; Trainium2 wins second-wave hyperscaler workloads",          src: "CNBC",       when: "4h" },
    { tk: "MRVL",  sev: "pos",  headline: "Marvell DPU qualified at third hyperscaler; FY27 pipeline raised",       src: "Reuters",    when: "5h" },
    { tk: "VST",   sev: "pos",  headline: "Vistra signs 15yr PPA at $82/MWh with unnamed hyperscaler",              src: "Bloomberg",  when: "6h" },
    { tk: "MU",    sev: "info", headline: "Micron HBM3E: second hyperscaler qualification confirmed",               src: "Nikkei",     when: "7h" },
    { tk: "ANET",  sev: "info", headline: "Arista 400G Ethernet wins share vs InfiniBand in AI cluster refresh",    src: "TheInformation", when: "9h" },
    { tk: "MTZ",   sev: "info", headline: "MasTec backlog hits record $14.6B; utility + telecom mix expanding",     src: "Defense News", when: "11h" }
  ],

  // ── News Wire fallback ──
  newsWire: [
    { tk: "FOMC",  sev: "warn", headline: "FOMC minutes show committee split on pace of 2H cuts",                  src: "Reuters",   when: "14m" },
    { tk: "AI",    sev: "info", headline: "Hyperscaler capex tracking +47% YoY — AVGO, MRVL, ANET exposure",       src: "Tavily",    when: "32m" },
    { tk: "CPI",   sev: "info", headline: "Core CPI 0.21% m/m, services ex-shelter cooling for 4th month",         src: "BLS",       when: "1h"  },
    { tk: "POWER", sev: "info", headline: "Grid operators raise AI datacenter power demand forecasts by 18%",       src: "Bloomberg", when: "2h"  },
    { tk: "10Y",   sev: "info", headline: "10Y-2Y spread widens to +38bps, curve steepening on soft-landing bets", src: "WSJ",       when: "3h"  },
    { tk: "SEMI",  sev: "warn", headline: "Export-control review may expand to advanced packaging tech",             src: "FT",        when: "4h"  },
    { tk: "DXY",   sev: "info", headline: "Dollar index softens; tech multinationals see FX translation tailwind",  src: "Reuters",   when: "5h"  },
    { tk: "OIL",   sev: "warn", headline: "OPEC+ signal weighs on energy — power-gen thesis diverges from E&P",    src: "Bloomberg", when: "7h"  }
  ],

  // ── Macro Correlation (14 monthly data points, base 100) ──
  macroSeries: {
    months: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    portfolio: [100.0, 102.8, 105.4, 103.1, 107.2, 109.8, 114.6, 118.2, 120.4, 122.8, 119.6, 125.4, 130.2, 134.8],
    spx:       [100.0, 101.6, 103.2, 102.4, 104.8, 105.6, 108.4, 110.2, 111.8, 113.2, 110.6, 114.4, 117.2, 119.8]
  },

  // ── SEC Filings fallback (from positions.js SEC_SEED, mapped to display shape) ──
  secFilings: [
    { tk: "MSFT", form: "10-Q", date: "2026-05-06", sentiment: "bull", summary: "Azure +33% cc; AI workloads contributing 8 pts; capex stepping up to $94B FY guide." },
    { tk: "AMZN", form: "10-Q", date: "2026-05-05", sentiment: "bull", summary: "AWS +21% cc; retail margin expansion; capex front-loaded into AI infra." },
    { tk: "MU",   form: "8-K",  date: "2026-05-04", sentiment: "bull", summary: "HBM3E qualified at second hyperscaler; FY27 HBM capacity sold-out commentary." },
    { tk: "AVGO", form: "10-Q", date: "2026-05-03", sentiment: "bull", summary: "Custom XPU revenue +140% YoY; VMware integration milestone reached ahead of schedule." },
    { tk: "ANET", form: "10-Q", date: "2026-05-02", sentiment: "bull", summary: "Campus networking + AI backend win rates above Street expectations; backlog at record." },
    { tk: "MRVL", form: "8-K",  date: "2026-04-28", sentiment: "bull", summary: "Third hyperscaler DPU design win announced; FY27 custom silicon revenue guidance raised." },
    { tk: "VST",  form: "10-Q", date: "2026-04-25", sentiment: "bull", summary: "Nuclear fleet availability 93%; AI PPA pipeline $4.2B contracted; generation costs stable." },
    { tk: "MTZ",  form: "10-Q", date: "2026-04-22", sentiment: "bull", summary: "Backlog $14.6B record; telecom + utility mix 68%; margin expansion on track." }
  ],

  // ── Scout discoveries — fallback / display while live data loads ──
  scouts: [],

  // ── DD cache — pre-canned results for portfolio tickers (live KV takes priority) ──
  ddCache: {},

  // ── Signal Scoreboard fallback — real 2026-07-04 numbers; live dd:scoreboard takes priority ──
  scoreboard: {
    v: 1,
    generated_at: "2026-07-04T08:00:00Z",
    as_of: "2026-07-04",
    benchmark: "VWRA.L",
    n_signals: 119, n_scout: 67, n_gems: 49,
    note: "pre-2026-07-03 entry prices are same-day-close backfills (approx)",
    versions: [
      { v: "unstamped", desc: "legacy ≤2026-07-02 — no factor stamp, backfilled entry prices" },
      { v: "v2", desc: "since 2026-07-03 — true momentum lens, anti-evidence removals, quality composite, fail-closed gate" },
      { v: "v3", desc: "since 2026-07-07 — gate grades not gates: R:R divergence is red-team input not an auto-reject, DOWNGRADE surfaces flagged, calm-window re-verification of UNVERIFIED holds" }
    ],
    windows: [
      {
        weeks: 1, measurable: 93, pending: 26, no_data: 0,
        overall: { n: 93, hit: 0.5591, mean: 0.0174, median: 0.0063 },
        buckets: {
          gate: [{ k: "unknown", n: 93, hit: 0.5591, mean: 0.0174, median: 0.0063 }],
          grade: [
            { k: "BUY", n: 77, hit: 0.5195, mean: 0.0143, median: 0.0038 },
            { k: "CONVICTION BUY", n: 1, hit: 1.0, mean: 0.0022, median: 0.0022 },
            { k: "STRONG BUY", n: 15, hit: 0.7333, mean: 0.0343, median: 0.018 }
          ],
          source: [
            { k: "gems", n: 43, hit: 0.65, mean: 0.023, median: 0.009 },
            { k: "scout", n: 50, hit: 0.48, mean: 0.012, median: -0.003 }
          ]
        },
        top: [
          { ticker: "PAY", excess: 0.2618 }, { ticker: "RIGL", excess: 0.1918 },
          { ticker: "FATN", excess: 0.1579 }, { ticker: "KVYO", excess: 0.1543 },
          { ticker: "TLX", excess: 0.1466 }
        ],
        bottom: [
          { ticker: "LEGN", excess: -0.2296 }, { ticker: "TMDX", excess: -0.1122 },
          { ticker: "UI", excess: -0.0913 }, { ticker: "GMED", excess: -0.0878 },
          { ticker: "KVYO", excess: -0.0761 }
        ]
      },
      { weeks: 4, measurable: 0, pending: 119, no_data: 0 },
      { weeks: 12, measurable: 0, pending: 119, no_data: 0 },
      { weeks: 26, measurable: 0, pending: 119, no_data: 0 },
      { weeks: 52, measurable: 0, pending: 119, no_data: 0 }
    ]
  }
};

// Seed quotes for initial render before Finnhub responds.
// Shape mirrors Finnhub /quote: { c, d, dp, v, h, l, pc }
window.SE_CONFIG = window.SE_CONFIG || {};
window.SE_CONFIG.SEED_QUOTES = {
  AMZN: { c: 225.00, d:  1.20, dp:  0.54, v: 28_000_000, pe: 44.0, eps: 5.12, target: 250.00 },
  ANET: { c:  93.00, d:  0.80, dp:  0.87, v:  5_200_000, pe: 46.0, eps: 2.02, target: 115.00 },
  EME:  { c: 462.00, d: -2.10, dp: -0.45, v:    320_000, pe: 22.0, eps: 21.0, target: 500.00 },
  MRVL: { c:  84.00, d:  1.40, dp:  1.69, v: 18_000_000, pe: 52.0, eps: 1.62, target: 110.00 },
  MTZ:  { c: 140.00, d:  0.90, dp:  0.65, v:    800_000, pe: 28.0, eps: 5.00, target: 160.00 },
  PENG: { c:  21.00, d: -0.30, dp: -1.41, v:    600_000, pe: 18.0, eps: 1.17, target: 28.00  },
  VST:  { c: 162.00, d:  3.20, dp:  2.01, v:  4_100_000, pe: 34.0, eps: 4.76, target: 195.00 },
  AVGO: { c: 227.00, d:  2.80, dp:  1.25, v:  9_000_000, pe: 36.0, eps: 6.31, target: 270.00 },
  GOOG: { c: 173.00, d: -0.60, dp: -0.35, v: 18_000_000, pe: 22.0, eps: 7.86, target: 210.00 },
  MSFT: { c: 446.00, d:  1.10, dp:  0.25, v: 16_000_000, pe: 35.0, eps: 12.7, target: 500.00 },
  MU:   { c: 113.00, d:  2.40, dp:  2.17, v: 20_000_000, pe: 14.0, eps: 8.07, target: 140.00 },
  NOW:  { c: 1050.0, d:  8.00, dp:  0.77, v:    900_000, pe: 60.0, eps: 17.5, target: 1200.0 },
  P:    { c:  82.00, d:  0.50, dp:  0.61, v:    250_000, pe: 32.0, eps: 2.56, target: 95.00  },
};
