/**
 * widgets.json — OpenBB Workspace widget definitions.
 *
 * Only widgets whose data endpoint is actually wired live here (no-mock-data
 * rule). The single-name metrics table is the skeleton's live widget; the
 * follow-up widgets (returns chart, L3 decomposition, snapshot PDF, rankings
 * screen, portfolio risk) are tracked in app/openbb/README.md and added one
 * route at a time.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../_lib/cors";

export const dynamic = "force-dynamic";

const WIDGETS = {
  rm_single_name_metrics: {
    name: "RiskModels — Single-Name Risk Metrics",
    description:
      "L1/L2/L3 hedge ratios and betas, annualised volatility, Lstar residual level, and recommended hedge level for one ticker.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/metrics",
    gridData: { w: 20, h: 12 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, NVDA, BRK.B).",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "metric", headerName: "Metric", cellDataType: "text" },
          { field: "value", headerName: "Value", cellDataType: "text" },
        ],
      },
    },
  },
  rm_single_name_snapshot: {
    name: "RiskModels — Risk Snapshot",
    description:
      "Single-name risk snapshot: L3 explained-risk decomposition (Market/Sector/Subsector/Residual), systematic share, volatility, recommended hedge level, and L3 hedge ratios.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/snapshot-table",
    gridData: { w: 20, h: 14 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, NVDA, BRK.B).",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "metric", headerName: "Metric", cellDataType: "text" },
          { field: "value", headerName: "Value", cellDataType: "text" },
        ],
      },
    },
  },
  rm_cumulative_return: {
    name: "RiskModels — Cumulative Total Return",
    description:
      "Total-return index (base 100) for one ticker, compounded from daily gross returns.",
    category: "Risk",
    source: ["RiskModels API"],
    endpoint: "widgets/returns-chart",
    gridData: { w: 40, h: 12 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, NVDA, BRK.B).",
      },
      {
        paramName: "years",
        value: "1",
        label: "Years",
        type: "text",
        description: "Look-back window in years.",
        options: [
          { value: "1", label: "1" },
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "5", label: "5" },
        ],
      },
    ],
    data: {
      table: {
        chartView: { enabled: true, chartType: "line" },
        showAll: false,
        columnsDefs: [
          { headerName: "Date", field: "date", chartDataType: "category" },
          { headerName: "Total return (indexed to 100)", field: "indexed_return" },
        ],
      },
    },
  },
  rm_risk_composition: {
    name: "RiskModels — L3 Explained-Risk Over Time",
    description:
      "Daily L3 variance decomposition (Market / Sector / Subsector / Residual, % of total) for one ticker. Equities only.",
    category: "Risk",
    source: ["RiskModels API"],
    endpoint: "widgets/risk-composition",
    gridData: { w: 40, h: 12 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, NVDA, BRK.B).",
      },
      {
        paramName: "years",
        value: "1",
        label: "Years",
        type: "text",
        description: "Look-back window in years.",
        options: [
          { value: "1", label: "1" },
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "5", label: "5" },
        ],
      },
    ],
    data: {
      table: {
        chartView: { enabled: true, chartType: "line" },
        showAll: false,
        columnsDefs: [
          { headerName: "Date", field: "date", chartDataType: "category" },
          { headerName: "Market %", field: "Market" },
          { headerName: "Sector %", field: "Sector" },
          { headerName: "Subsector %", field: "Subsector" },
          { headerName: "Residual %", field: "Residual" },
        ],
      },
    },
  },
  rm_rankings_top: {
    name: "RiskModels — Top Rankings",
    description:
      "Top-ranked names by a chosen metric, cohort, and window (cross-sectional percentile ranks). Point-in-time metrics (market cap, explained risk L1/L2/L3, stock-specific) rank at the 1-day window; return and residual metrics use the longer windows.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/rankings-top",
    gridData: { w: 24, h: 14 },
    params: [
      {
        paramName: "metric",
        value: "mkt_cap",
        label: "Metric",
        type: "text",
        description: "Ranking metric.",
        options: [
          { value: "gross_return", label: "Gross return" },
          { value: "mkt_cap", label: "Market cap" },
          { value: "sector_residual", label: "Sector residual" },
          { value: "subsector_residual", label: "Subsector residual" },
          { value: "er_l1", label: "Explained risk (L1)" },
          { value: "er_l2", label: "Explained risk (L2)" },
          { value: "er_l3", label: "Explained risk (L3)" },
          { value: "stock_specific_lstar", label: "Stock-specific (Lstar)" },
        ],
      },
      {
        paramName: "cohort",
        value: "universe",
        label: "Cohort",
        type: "text",
        description: "Ranking cohort.",
        options: [
          { value: "universe", label: "Universe" },
          { value: "sector", label: "Sector" },
          { value: "subsector", label: "Subsector" },
        ],
      },
      {
        paramName: "window",
        value: "1d",
        label: "Window",
        type: "text",
        description: "Look-back window. Use 1d for point-in-time metrics.",
        options: [
          { value: "1d", label: "1 day" },
          { value: "21d", label: "21 days" },
          { value: "63d", label: "63 days" },
          { value: "252d", label: "252 days" },
        ],
      },
      {
        paramName: "limit",
        value: "10",
        label: "Limit",
        type: "text",
        description: "Number of names.",
        options: [
          { value: "10", label: "10" },
          { value: "25", label: "25" },
          { value: "50", label: "50" },
          { value: "100", label: "100" },
        ],
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "rank", headerName: "Rank" },
          { field: "ticker", headerName: "Ticker" },
          { field: "percentile", headerName: "Percentile" },
          { field: "cohort_size", headerName: "Cohort size" },
        ],
      },
    },
  },
  rm_rankings_single: {
    name: "RiskModels — Single-Name Rankings",
    description:
      "One ticker's cross-sectional rank + percentile across every metric, cohort, and window.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/rankings",
    gridData: { w: 24, h: 14 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, NVDA, BRK.B).",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "metric", headerName: "Metric" },
          { field: "cohort", headerName: "Cohort" },
          { field: "window", headerName: "Window" },
          { field: "percentile", headerName: "Percentile" },
          { field: "rank_ordinal", headerName: "Rank" },
          { field: "cohort_size", headerName: "Cohort size" },
        ],
      },
    },
  },
  rm_portfolio_risk: {
    name: "RiskModels — Portfolio Risk & Hedge",
    description:
      "Portfolio-level L3 explained-risk decomposition, volatility, and the L1/L2/L3 hedge-layering ladder for a list of positions.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/portfolio",
    gridData: { w: 24, h: 16 },
    params: [
      {
        paramName: "positions",
        value: "AAPL:0.4, MSFT:0.35, NVDA:0.25",
        label: "Positions",
        type: "text",
        description:
          "Comma-separated ticker:weight (e.g. AAPL:0.4, MSFT:0.35, NVDA:0.25). Weights auto-normalise; bare tickers = equal weight.",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "metric", headerName: "Metric", cellDataType: "text" },
          { field: "value", headerName: "Value", cellDataType: "text" },
        ],
      },
    },
  },
  rm_portfolio_positions: {
    name: "RiskModels — Portfolio Positions",
    description:
      "Per-position breakdown for the same portfolio: weight, L3 explained-risk split, and L3 hedge ratios.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/portfolio-positions",
    gridData: { w: 24, h: 14 },
    params: [
      {
        paramName: "positions",
        value: "AAPL:0.4, MSFT:0.35, NVDA:0.25",
        label: "Positions",
        type: "text",
        description: "Comma-separated ticker:weight.",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "ticker", headerName: "Ticker" },
          { field: "weight", headerName: "Weight" },
          { field: "market_er", headerName: "Market ER" },
          { field: "residual_er", headerName: "Residual ER" },
          { field: "mkt_hr", headerName: "Mkt HR" },
          { field: "sec_hr", headerName: "Sec HR" },
          { field: "sub_hr", headerName: "Sub HR" },
        ],
      },
    },
  },
} as const;

export async function GET(req: NextRequest) {
  return NextResponse.json(WIDGETS, {
    headers: openbbCors(req),
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
