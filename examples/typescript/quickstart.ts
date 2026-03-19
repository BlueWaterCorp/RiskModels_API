/**
 * RiskModels API — Quickstart: Hedge a Single Stock (TypeScript)
 *
 * Fetches daily returns and rolling L1/L2/L3 hedge ratios for a ticker.
 * The latest row gives the current hedge ratio to use for a live trade.
 *
 * npm install node-fetch   (or use native fetch in Node 18+)
 * npx ts-node quickstart.ts
 */

const API_KEY  = "PASTE_YOUR_KEY_HERE";  // <-- paste your RiskModels API key
const BASE_URL = "https://riskmodels.net/api";
const HEADERS  = { Authorization: `Bearer ${API_KEY}` };

if (API_KEY === "PASTE_YOUR_KEY_HERE") {
  throw new Error("Please paste your API key above before running.");
}

// ── Response types ─────────────────────────────────────────────────────────────
interface ReturnsMeta {
  market_etf:    string;
  sector_etf:    string;
  subsector_etf: string;
}

interface ReturnsRow {
  date:  string;
  stock: number;  // daily gross return
  l1:    number;  // rolling L1 combined hedge ratio
  l2:    number;  // rolling L2 combined hedge ratio
  l3:    number;  // rolling L3 combined hedge ratio
}

interface AgentMeta {
  cost_usd:     number;
  cache_status: string;
  latency_ms:   number;
}

interface TickerReturnsResponse {
  meta:   ReturnsMeta;
  data:   ReturnsRow[];
  _agent: AgentMeta;
}

// ── Fetch ticker returns ───────────────────────────────────────────────────────
async function getHedgeRatios(ticker: string, years = 1): Promise<void> {
  const url = new URL(`${BASE_URL}/ticker-returns`);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("years",  String(years));

  const resp = await fetch(url.toString(), { headers: HEADERS });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`API error ${resp.status}: ${JSON.stringify(err)}`);
  }

  const body: TickerReturnsResponse = await resp.json();
  const { meta, data, _agent } = body;

  // Sort by date ascending, take the latest row
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  console.log(`\nLatest hedge ratios — ${ticker}`);
  console.log("─".repeat(40));
  console.log(`  Date:                   ${latest.date}`);
  console.log(`  Market ETF (L1):        ${meta.market_etf}`);
  console.log(`  Sector ETF (L2):        ${meta.sector_etf}`);
  console.log(`  Subsector ETF (L3):     ${meta.subsector_etf}`);
  console.log(`  L1 hedge (market only): ${latest.l1.toFixed(4)}`);
  console.log(`  L2 hedge (mkt+sector):  ${latest.l2.toFixed(4)}`);
  console.log(`  L3 hedge (full):        ${latest.l3.toFixed(4)}`);

  console.log(`\nMost recent 5 trading days:`);
  const recent = sorted.slice(-5);
  console.log("  date        | stock_return | l1_hedge | l2_hedge | l3_hedge");
  console.log("  " + "-".repeat(62));
  for (const row of recent) {
    console.log(
      `  ${row.date}  | ${row.stock.toFixed(4).padStart(12)} | ${row.l1.toFixed(4).padStart(8)} | ${row.l2.toFixed(4).padStart(8)} | ${row.l3.toFixed(4).padStart(8)}`
    );
  }

  console.log(`\n  Cost: $${_agent.cost_usd.toFixed(4)}  |  Cache: ${_agent.cache_status}  |  Latency: ${_agent.latency_ms}ms`);
}

// ── Example: compute hedge notional for a $100k NVDA position ──────────────────
async function exampleHedgeNotional(): Promise<void> {
  const ticker       = "NVDA";
  const positionUsd  = 100_000;

  const url = new URL(`${BASE_URL}/metrics/${ticker}`);
  const resp = await fetch(url.toString(), { headers: HEADERS });
  if (!resp.ok) throw new Error(`${resp.status} fetching metrics`);

  const m = await resp.json();

  const spyHedgeL1 = positionUsd * (m.l1_market_hr ?? 0);
  const spyHedgeL3 = positionUsd * (m.l3_market_hr ?? 0);
  const sectorHedge   = positionUsd * (m.l3_sector_hr ?? 0);
  const subsectorHedge = positionUsd * (m.l3_subsector_hr ?? 0);

  console.log(`\nHedge notionals for $${positionUsd.toLocaleString()} ${ticker} position:`);
  console.log(`  L1 — Short SPY:     $${spyHedgeL1.toFixed(0)}`);
  console.log(`  L3 — Short SPY:     $${spyHedgeL3.toFixed(0)}`);
  console.log(`  L3 — Sector ETF:    $${sectorHedge.toFixed(0)}  (${m.l3_sector_hr >= 0 ? "short" : "long"})`);
  console.log(`  L3 — Subsector ETF: $${Math.abs(subsectorHedge).toFixed(0)}  (${(m.l3_subsector_hr ?? 0) >= 0 ? "short" : "long"})`);
  console.log(`  Residual risk:      ${((m.l3_residual_er ?? 0) * 100).toFixed(1)}% (cannot be hedged)`);
}

// ── Run ────────────────────────────────────────────────────────────────────────
(async () => {
  await getHedgeRatios("NVDA", 1);
  await exampleHedgeNotional();
})();
