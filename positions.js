// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN EYE — Your Positions
// ═══════════════════════════════════════════════════════════════════════════
// Edit this file to add/remove positions across your brokerage accounts.
// Fields:
//   ticker   — stock symbol (e.g. "NVDA")
//   name     — display name
//   broker   — brokerage name (e.g. "IBKR", "Tiger", "Schwab")
//   qty      — number of shares you hold
//   avg      — your average cost basis per share
//   sector   — sector label for grouping
//   industry — sub-industry label
//
// Live prices, day change, fundamentals, news, and SEC filings are
// fetched automatically — you only need to maintain this list.
// ═══════════════════════════════════════════════════════════════════════════

const MY_POSITIONS = [
  // ── Tech / Semis ──
  { ticker: "NVDA",  name: "NVIDIA Corp",          broker: "IBKR",  qty: 50,  avg: 480.20,  sector: "Tech",         industry: "Semis - GPU" },
  { ticker: "ASML",  name: "ASML Holding NV",      broker: "IBKR",  qty: 20,  avg: 720.10,  sector: "Tech",         industry: "Semis - Litho" },
  { ticker: "MSFT",  name: "Microsoft Corp",       broker: "IBKR",  qty: 60,  avg: 312.40,  sector: "Tech",         industry: "Software" },
  { ticker: "GOOGL", name: "Alphabet Cl A",        broker: "IBKR",  qty: 90,  avg: 138.60,  sector: "Tech",         industry: "Internet - Ads" },
  { ticker: "MU",    name: "Micron Technology",     broker: "Tiger", qty: 150, avg: 92.40,   sector: "Tech",         industry: "Semis - Memory" },
  { ticker: "PENG",  name: "Penguin Solutions",     broker: "Tiger", qty: 300, avg: 14.10,   sector: "Tech",         industry: "AI Infra" },

  // ── Financials ──
  { ticker: "JPM",   name: "JPMorgan Chase",       broker: "IBKR",  qty: 80,  avg: 168.20,  sector: "Financials",   industry: "Money-center Bank" },
  { ticker: "V",     name: "Visa Inc",             broker: "Tiger", qty: 70,  avg: 248.10,  sector: "Financials",   industry: "Payments" },

  // ── Healthcare ──
  { ticker: "UNH",   name: "UnitedHealth Group",   broker: "IBKR",  qty: 25,  avg: 478.30,  sector: "Healthcare",   industry: "Managed Care" },
  { ticker: "LLY",   name: "Eli Lilly & Co",       broker: "Tiger", qty: 18,  avg: 612.40,  sector: "Healthcare",   industry: "Pharma - GLP-1" },

  // ── Consumer ──
  { ticker: "AMZN",  name: "Amazon.com",           broker: "IBKR",  qty: 75,  avg: 142.10,  sector: "Cons. Disc.",  industry: "E-commerce - Cloud" },
  { ticker: "COST",  name: "Costco Wholesale",     broker: "Tiger", qty: 22,  avg: 612.20,  sector: "Cons. Stap.",  industry: "Big-box Retail" },

  // ── Energy ──
  { ticker: "XOM",   name: "Exxon Mobil",          broker: "Tiger", qty: 120, avg: 102.40,  sector: "Energy",       industry: "Integrated O&G" },

  // ── Industrials ──
  { ticker: "GE",    name: "GE Aerospace",         broker: "IBKR",  qty: 95,  avg: 128.30,  sector: "Industrials",  industry: "Aero Engines" },

  // ── Cash (set qty=1 and avg=your cash balance) ──
  { ticker: "USD",   name: "Cash - Sweep",         broker: "IBKR",  qty: 1,   avg: 42800,   sector: "Cash",         industry: "Money Market" },
];

// ═══════════════════════════════════════════════════════════════════════════
// API Configuration
// ═══════════════════════════════════════════════════════════════════════════
// FMP (Financial Modeling Prep) — used for live quotes, fundamentals, and news.
// Get a free key at: https://financialmodelingprep.com/developer
//
// For GitHub Pages / Cloudflare Pages deployment, this key is visible in
// source. This is acceptable for a personal private dashboard.
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  FMP_API_KEY: "Owc612vQMnEBkPrrBGvtzC7A4ms6P6hi",
  REFRESH_INTERVAL_MS: 60000,  // auto-refresh every 60 seconds
};

// Sector palette for heatmap grouping
const SECTOR_COLORS = {
  "Tech":         "#60a5fa",
  "Financials":   "#34d399",
  "Healthcare":   "#f472b6",
  "Cons. Disc.":  "#fb923c",
  "Cons. Stap.":  "#fbbf24",
  "Energy":       "#f87171",
  "Industrials":  "#a78bfa",
  "Cash":         "#71717a",
};

window.SE_CONFIG = { MY_POSITIONS, CONFIG, SECTOR_COLORS };
