// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN ENGINE — YOUR POSITIONS (edit this file!)
// ═══════════════════════════════════════════════════════════════════════════
//
// HOW TO USE:
// 1. Replace the sample positions below with YOUR actual holdings
// 2. For each position, fill in:
//      ticker  — stock symbol exactly as it appears on your broker
//      name    — any display name you like
//      broker  — which brokerage holds this position (e.g. "IBKR", "Tiger")
//      qty     — number of shares you own
//      avg     — your average cost basis per share (what you paid)
//      sector  — sector label for grouping in the heatmap
//      industry — sub-label (optional, for display only)
//
// 3. For cash positions: set ticker="USD", qty=1, avg=your cash balance
// 4. Save the file and refresh the browser — live prices load automatically
//
// ═══════════════════════════════════════════════════════════════════════════

const MY_POSITIONS = [
  // ── IBKR ──
  { ticker: "AMZN",  name: "Amazon.com",            broker: "IBKR",  qty: 40,  avg: 237.45,  sector: "Cons. Disc.",  industry: "E-commerce · Cloud" },
  { ticker: "ANET",  name: "Arista Networks",       broker: "IBKR",  qty: 80,  avg: 143.64,  sector: "Tech",         industry: "Networking" },
  { ticker: "EME",   name: "EMCOR Group",           broker: "IBKR",  qty: 13,  avg: 922.69,  sector: "Industrials",  industry: "Electrical · Mech" },
  { ticker: "MPWR",  name: "Monolithic Power Sys",  broker: "IBKR",  qty: 7,   avg: 1605.00, sector: "Tech",         industry: "Semis · Power" },
  { ticker: "MRVL",  name: "Marvell Technology",    broker: "IBKR",  qty: 67,  avg: 153.04,  sector: "Tech",         industry: "Semis · Custom AI" },
  { ticker: "PENG",  name: "Penguin Solutions",     broker: "IBKR",  qty: 234, avg: 22.37,   sector: "Tech",         industry: "AI Infra" },
  { ticker: "SKWD",  name: "Skyward Specialty Ins", broker: "IBKR",  qty: 220, avg: 45.78,   sector: "Financials",   industry: "Specialty Insurance" },

  // ── Tiger ──
  { ticker: "AVGO",  name: "Broadcom Inc",          broker: "Tiger", qty: 24,  avg: 373.41,  sector: "Tech",         industry: "Semis · Networking" },
  { ticker: "GOOG",  name: "Alphabet Cl C",         broker: "Tiger", qty: 30,  avg: 173.74,  sector: "Tech",         industry: "Internet · Ads" },
  { ticker: "MSFT",  name: "Microsoft Corp",        broker: "Tiger", qty: 27,  avg: 414.58,  sector: "Tech",         industry: "Software · Cloud" },
  { ticker: "MU",    name: "Micron Technology",     broker: "Tiger", qty: 17,  avg: 611.12,  sector: "Tech",         industry: "Semis · Memory" },
  { ticker: "NOW",   name: "ServiceNow",            broker: "Tiger", qty: 112, avg: 92.02,   sector: "Tech",         industry: "Enterprise SaaS" },
  { ticker: "RDDT",  name: "Reddit Inc",            broker: "Tiger", qty: 15,  avg: 172.71,  sector: "Comm.",        industry: "Social Media" },
];

// ═══════════════════════════════════════════════════════════════════════════
// API Key — Finnhub (free, 60 calls/min, supports browser CORS)
// Get your own free key at: https://finnhub.io/register
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  FINNHUB_API_KEY: "d740g09r01qno4pvvc1gd740g09r01qno4pvvc20",
  REFRESH_INTERVAL_MS: 60000,  // auto-refresh every 60s
};

// Sector palette for heatmap grouping (add more as needed)
const SECTOR_COLORS = {
  "Tech":         "#60a5fa",
  "Financials":   "#34d399",
  "Healthcare":   "#f472b6",
  "Cons. Disc.":  "#fb923c",
  "Cons. Stap.":  "#fbbf24",
  "Energy":       "#f87171",
  "Industrials":  "#a78bfa",
  "Materials":    "#a3e635",
  "Utilities":    "#67e8f9",
  "Real Estate":  "#f0abfc",
  "Comm.":        "#fdba74",
  "Cash":         "#71717a",
};

const SECTOR_OPTIONS = ["Tech","Financials","Healthcare","Cons. Disc.","Cons. Stap.","Energy","Industrials","Materials","Utilities","Real Estate","Comm.","Cash"];

// ═══════════════════════════════════════════════════════════════════════════
// SYNTHESIS — Gemini-style intelligence (static seed; LLM-refreshable)
// ═══════════════════════════════════════════════════════════════════════════

const SYNTHESIS = {
  catalysts: [
    "Mega-cap AI capex (MSFT, AMZN, GOOGL) re-rating extends to 2H26 — your 28% AI-infra exposure (NVDA+ASML+MU+PENG) is the leveraged play on the same thesis.",
    "LLY Phase 3 read-out de-risks the GLP-1 leg; healthcare sleeve outperforming staples on a beta-adjusted basis.",
    "GE Aerospace shop-visit cycle and JPM credit re-acceleration broaden the rally beyond mega-cap tech.",
  ],
  risks: [
    "Top-3 concentration (NVDA + MSFT + AMZN) is 41% of NLV — single-name idiosyncratic risk dominates the book.",
    "UNH headline overhang and DOJ scope expansion creates managed-care correlation drag — consider hedge.",
    "Energy beta-decoupling: XOM down on OPEC+ signal while broad market grinds higher; small position can wait.",
  ],
  macro: [
    "10Y–2Y at +38 bps and steepening — historically a tailwind for cyclicals (GE, JPM) over staples.",
    "Real yields easing supports duration plays (LLY, COST); your defensive sleeve has room to re-rate.",
    "DXY softening adds a translation tailwind to ASML, GOOGL, MSFT international segments.",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// MACRO SERIES — synthetic monthly data for the correlation chart
// ═══════════════════════════════════════════════════════════════════════════

const MACRO_SERIES = {
  portfolio: [100, 102.4, 105.1, 103.8, 108.6, 112.3, 118.9, 122.1, 119.4, 126.8, 134.2, 141.7, 138.4, 146.2],
  spx:       [100, 101.2, 102.8, 101.4, 104.6, 106.9, 110.4, 112.8, 110.2, 114.6, 119.1, 122.8, 119.8, 125.4],
  spread:    [-42, -38, -31, -25, -18, -10, -2, 5, 12, 18, 24, 31, 35, 38],
  labels:    ["M-13","M-12","M-11","M-10","M-9","M-8","M-7","M-6","M-5","M-4","M-3","M-2","M-1","Now"],
};

// ═══════════════════════════════════════════════════════════════════════════
// SEC FILINGS — seed data with Gemini TL;DR summaries
// ═══════════════════════════════════════════════════════════════════════════

const SEC_SEED = [
  { ticker: "NVDA", form: "10-Q", date: "2026-05-07", url: "EDGAR/0001045810-26-000089", tldr: "DC revenue +147% YoY; Blackwell ramp ahead of plan; gross margin guided 75–76%." },
  { ticker: "JPM",  form: "10-Q", date: "2026-05-07", url: "EDGAR/0000019617-26-000058", tldr: "NII up 4% QoQ; reserve build modest; CET1 15.4%; buyback authorization $30B reaffirmed." },
  { ticker: "LLY",  form: "10-Q", date: "2026-05-06", url: "EDGAR/0000059478-26-000044", tldr: "GLP-1 portfolio +71% YoY; supply now constraint, not demand; FY guide raised twice." },
  { ticker: "MSFT", form: "10-Q", date: "2026-05-06", url: "EDGAR/0000789019-26-000091", tldr: "Azure +33% cc; AI workloads contributing 8 pts; capex stepping up to $94B FY guide." },
  { ticker: "AMZN", form: "10-Q", date: "2026-05-05", url: "EDGAR/0001018724-26-000038", tldr: "AWS +21% cc; retail margin expansion; capex front-loaded into AI infra." },
  { ticker: "MU",   form: "8-K",  date: "2026-05-04", url: "EDGAR/0000723125-26-000112", tldr: "HBM3E qualified at second hyperscaler; FY27 HBM capacity sold-out commentary." },
  { ticker: "XOM",  form: "10-Q", date: "2026-05-02", url: "EDGAR/0000034088-26-000071", tldr: "Permian production at record; downstream margin compressed; Pioneer synergies on track." },
  { ticker: "UNH",  form: "8-K",  date: "2026-05-01", url: "EDGAR/0000731766-26-000034", tldr: "MLR elevated 84.8%; Optum Health margin reset; FY26 guide trimmed." },
];

// ═══════════════════════════════════════════════════════════════════════════
// NEWS — seed headlines
// ═══════════════════════════════════════════════════════════════════════════

const NEWS_SEED = [
  { ticker: "NVDA", src: "Reuters",       ago: "14m", title: "Blackwell B200 supply allocation shifts toward sovereign AI buyers" },
  { ticker: "JPM",  src: "Bloomberg",     ago: "32m", title: "JPMorgan reaffirms $30B buyback; Dimon flags credit normalization" },
  { ticker: "LLY",  src: "WSJ",           ago: "48m", title: "Lilly orforglipron oral GLP-1 meets primary endpoint in Phase 3" },
  { ticker: "MSFT", src: "TheInformation",ago: "1h",  title: "Microsoft Azure AI capacity in Asia hits 92% utilization" },
  { ticker: "XOM",  src: "FT",            ago: "2h",  title: "Brent slides 3% on OPEC+ output signal; majors weigh capex pace" },
  { ticker: "AMZN", src: "CNBC",          ago: "3h",  title: "Amazon Trainium2 wins second-wave hyperscaler workloads" },
  { ticker: "UNH",  src: "Reuters",       ago: "5h",  title: "UnitedHealth — DOJ probe expands; managed-care peers under pressure" },
  { ticker: "GE",   src: "Aviation Week", ago: "7h",  title: "GE Aerospace LEAP shop visits accelerate; CFM backlog at 11k engines" },
];

// ═══════════════════════════════════════════════════════════════════════════
// NEWS WIRE — seed items for LLM-synthesized wire
// ═══════════════════════════════════════════════════════════════════════════

const WIRE_SEED = [
  { tag: "TICKER", ticker_or_sector: "NVDA",  source: "Reuters",   ago: "2m",  headline: "Nvidia secures additional sovereign-AI buildout commitments",                  severity: "info"  },
  { tag: "MACRO",  ticker_or_sector: "MACRO", source: "Bloomberg", ago: "4m",  headline: "Treasury yield curve steepens to +38 bps as 2Y rallies on cooling-CPI bets",  severity: "watch" },
  { tag: "SECTOR", ticker_or_sector: "Tech",  source: "FT",        ago: "7m",  headline: "Hyperscaler capex commentary lifts AI-infrastructure complex into the close",  severity: "info"  },
  { tag: "TICKER", ticker_or_sector: "MSFT",  source: "WSJ",       ago: "11m", headline: "Microsoft Asia Azure capacity utilization said to top 92% on inference demand", severity: "info"  },
];

window.SE_CONFIG = { MY_POSITIONS, CONFIG, SECTOR_COLORS, SECTOR_OPTIONS, SYNTHESIS, MACRO_SERIES, SEC_SEED, NEWS_SEED, WIRE_SEED };
