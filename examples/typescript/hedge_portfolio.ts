/**
 * RiskModels API — Hedge a Portfolio (TypeScript)
 *
 * Uses the /batch/analyze endpoint to fetch the full 6-component hedge breakdown
 * for multiple tickers in one call. Computes weighted portfolio-level hedge ratios.
 *
 * npx ts-node hedge_portfolio.ts
 */

const API_KEY  = "PASTE_YOUR_KEY_HERE";  // <-- paste your RiskModels API key
const BASE_URL = "https://riskmodels.net/api";
const HEADERS  = {
  Authorization:  `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

if (API_KEY === "PASTE_YOUR_KEY_HERE") {
  throw new Error("Please paste your API key above before running.");
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface HedgeRatios {
  l1_market:   number | null;
  l2_market:   number | null;
  l2_sector:   number | null;
  l3_market:   number | null;
  l3_sector:   number | null;
  l3_subsector: number | null;
}

interface TickerResult {
  status:       string;
  hedge_ratios: HedgeRatios | null;
}

interface BatchResponse {
  results: Record<string, TickerResult>;
  summary: { total: number; success: number; errors: number };
  _agent:  { cost_usd: number; latency_ms: number };
}

interface PositionHedge {
  ticker:       string;
  weight:       number;
  status:       string;
  l1_market_hr: number | null;
  l2_market_hr: number | null;
  l2_sector_hr: number | null;
  l3_market_hr: number | null;
  l3_sector_hr: number | null;
  l3_sub_hr:    number | null;
}

// ── Portfolio definition ───────────────────────────────────────────────────────
const portfolio: Record<string, number> = {
  AAPL:  0.25,
  MSFT:  0.20,
  NVDA:  0.20,
  GOOGL: 0.15,
  AMZN:  0.10,
  JPM:   0.10,
};

// ── Batch request ──────────────────────────────────────────────────────────────
async function hedgePortfolio(): Promise<void> {
  const resp = await fetch(`${BASE_URL}/batch/analyze`, {
    method:  "POST",
    headers: HEADERS,
    body: JSON.stringify({
      tickers: Object.keys(portfolio),
      metrics: ["hedge_ratios"],
      years:   1,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`API error ${resp.status}: ${JSON.stringify(err)}`);
  }

  const body: BatchResponse = await resp.json();
  const { results, summary, _agent } = body;

  // ── Per-position breakdown ───────────────────────────────────────────────────
  const rows: PositionHedge[] = Object.entries(portfolio).map(([ticker, weight]) => {
    const r  = results[ticker] ?? { status: "error", hedge_ratios: null };
    const hr = r.hedge_ratios;  // null if ticker not in universe
    return {
      ticker,
      weight,
      status:       r.status,
      l1_market_hr: hr?.l1_market   ?? null,
      l2_market_hr: hr?.l2_market   ?? null,
      l2_sector_hr: hr?.l2_sector   ?? null,
      l3_market_hr: hr?.l3_market   ?? null,
      l3_sector_hr: hr?.l3_sector   ?? null,
      l3_sub_hr:    hr?.l3_subsector ?? null,
    };
  });

  // ── Weighted portfolio-level hedge ratios ────────────────────────────────────
  let wtdL1Market = 0, wtdL2Market = 0, wtdL3Market = 0;
  for (const row of rows) {
    if (row.l1_market_hr !== null) wtdL1Market += row.weight * row.l1_market_hr;
    if (row.l2_market_hr !== null) wtdL2Market += row.weight * row.l2_market_hr;
    if (row.l3_market_hr !== null) wtdL3Market += row.weight * row.l3_market_hr;
  }

  console.log("Portfolio-level hedge ratios (weighted average):");
  console.log(`  L1 market hedge (wtd): ${wtdL1Market.toFixed(4)}`);
  console.log(`  L2 market hedge (wtd): ${wtdL2Market.toFixed(4)}`);
  console.log(`  L3 market hedge (wtd): ${wtdL3Market.toFixed(4)}`);

  // ── Per-position table ───────────────────────────────────────────────────────
  console.log("\nPer-position breakdown:");
  console.log(
    "  ticker | wgt  | status  | l1_mkt | l2_mkt | l2_sec | l3_mkt | l3_sec | l3_sub"
  );
  console.log("  " + "-".repeat(80));
  for (const r of rows) {
    const fmt = (v: number | null) => v !== null ? v.toFixed(3).padStart(6) : " null ";
    console.log(
      `  ${r.ticker.padEnd(6)} | ${r.weight.toFixed(2)} | ${r.status.padEnd(7)} | ${fmt(r.l1_market_hr)} | ${fmt(r.l2_market_hr)} | ${fmt(r.l2_sector_hr)} | ${fmt(r.l3_market_hr)} | ${fmt(r.l3_sector_hr)} | ${fmt(r.l3_sub_hr)}`
    );
  }

  console.log(`\nBatch summary: ${summary.success}/${summary.total} success`);
  console.log(`Cost: $${_agent.cost_usd.toFixed(4)}  |  Latency: ${_agent.latency_ms}ms`);

  // ── Example: compute actual notional hedge amounts ───────────────────────────
  const PORTFOLIO_SIZE_USD = 1_000_000;
  console.log(`\nHedge notionals for $${PORTFOLIO_SIZE_USD.toLocaleString()} portfolio (L3):`);
  let totalSpyShort = 0, totalSectorShort = 0;
  for (const r of rows) {
    if (r.l3_market_hr === null) continue;
    const pos         = PORTFOLIO_SIZE_USD * r.weight;
    const spyAmt      = pos * r.l3_market_hr;
    const sectorAmt   = pos * (r.l3_sector_hr ?? 0);
    totalSpyShort    += spyAmt;
    totalSectorShort += sectorAmt;
    console.log(`  ${r.ticker}: Short $${spyAmt.toFixed(0)} SPY + $${sectorAmt.toFixed(0)} sector ETF`);
  }
  console.log(`  Total SPY short:    $${totalSpyShort.toFixed(0)}`);
  console.log(`  Total sector short: $${totalSectorShort.toFixed(0)}`);
}

// ── Run ────────────────────────────────────────────────────────────────────────
hedgePortfolio().catch(console.error);
