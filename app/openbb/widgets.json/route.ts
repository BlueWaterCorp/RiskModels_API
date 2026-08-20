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
    refetchInterval: 60000,
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
    refetchInterval: 60000,
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
          {
            headerName: "Total return (indexed to 100)",
            field: "indexed_return",
            renderFn: "columnColor",
            renderFnParams: {
              colorRules: [
                { condition: "gt", value: 100, color: "green" },
                { condition: "lt", value: 100, color: "red" },
              ],
            },
          },
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
  rm_etf_factor_returns: {
    name: "RiskModels — Factor ETF Trailing Returns",
    description:
      "Trailing 1d/21d/63d/252d total returns for SPY + the 11 GICS sector SPDR ETFs, as of the latest snapshot (one-teo, cross-sectional).",
    category: "Risk",
    source: ["RiskModels API"],
    endpoint: "widgets/etf-factor-returns",
    gridData: { w: 40, h: 12 },
    refetchInterval: 60000,
    params: [
      {
        paramName: "sleeve",
        value: "all",
        label: "Sleeve",
        type: "text",
        description: "Filter to market (SPY) or sector SPDRs, or show all.",
        options: [
          { value: "all", label: "All" },
          { value: "market", label: "Market" },
          { value: "sector", label: "Sector" },
        ],
      },
    ],
    data: {
      table: {
        chartView: { enabled: true, chartType: "bar" },
        showAll: true,
        columnsDefs: [
          { headerName: "Ticker", field: "ticker", chartDataType: "category" },
          { headerName: "Name", field: "name" },
          {
            headerName: "1D %",
            field: "return_1d",
            renderFn: "columnColor",
            renderFnParams: {
              colorRules: [
                { condition: "gt", value: 0, color: "green" },
                { condition: "lt", value: 0, color: "red" },
              ],
            },
          },
          {
            headerName: "21D %",
            field: "return_21d",
            renderFn: "columnColor",
            renderFnParams: {
              colorRules: [
                { condition: "gt", value: 0, color: "green" },
                { condition: "lt", value: 0, color: "red" },
              ],
            },
          },
          {
            headerName: "63D %",
            field: "return_63d",
            renderFn: "columnColor",
            renderFnParams: {
              colorRules: [
                { condition: "gt", value: 0, color: "green" },
                { condition: "lt", value: 0, color: "red" },
              ],
            },
          },
          {
            headerName: "252D %",
            field: "return_252d",
            renderFn: "columnColor",
            renderFnParams: {
              colorRules: [
                { condition: "gt", value: 0, color: "green" },
                { condition: "lt", value: 0, color: "red" },
              ],
            },
          },
        ],
      },
    },
  },
  rm_tearsheet: {
    name: "RiskModels — Risk Snapshot Tearsheet",
    description:
      "Single-name L3 risk snapshot for the grouped ticker (explained risk, hedge ratios, last close).",
    category: "Risk",
    type: "html",
    source: ["RiskModels API"],
    endpoint: "widgets/tearsheet",
    gridData: { w: 24, h: 18 },
    staleTime: 0,
    raw: true,
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, NVDA, BRK.B).",
      },
    ],
  },
  rm_etf_holdings: {
    name: "RiskModels — ETF Holdings",
    description:
      "Top-N current holdings of an ETF from its canonical PortfolioSurface (Funds Data Plane). Holdings carry bw_sym_id (no public ticker resolution exists for this identifier) plus weight and market value.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/etf-holdings",
    gridData: { w: 24, h: 14 },
    params: [
      {
        paramName: "ticker",
        value: "IVV",
        label: "ETF ticker",
        type: "text",
        description: "ETF ticker (e.g. IVV, SPY, QQQ).",
      },
      {
        paramName: "top",
        value: "25",
        label: "Top N",
        type: "text",
        description: "Number of holdings to return.",
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
          { field: "bw_sym_id", headerName: "Symbol (bw_sym_id)" },
          { field: "weight_pct", headerName: "Weight %" },
          { field: "adj_mv", headerName: "Market value" },
          { field: "sponsor", headerName: "Sponsor" },
          { field: "report_date", headerName: "Report date" },
        ],
      },
    },
  },
  rm_filer_holdings: {
    name: "RiskModels — 13F Filer Holdings",
    description:
      "Top-N holdings at a 13F filer's latest reported quarter, with ticker/name and latest L3 explained-risk shares (best-effort enrichment). Look up bw_filer_id via /13f/filers/search first.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/filer-holdings",
    gridData: { w: 24, h: 14 },
    params: [
      {
        paramName: "bw_filer_id",
        value: "",
        label: "Filer ID",
        type: "text",
        description: "Opaque bw_filer_id — look one up via /13f/filers/search.",
      },
      {
        paramName: "limit",
        value: "25",
        label: "Limit",
        type: "text",
        description: "Number of holdings to return.",
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
          { field: "ticker", headerName: "Ticker" },
          { field: "name", headerName: "Name" },
          { field: "weight_pct", headerName: "Weight %" },
          { field: "adj_mv", headerName: "Market value" },
          { field: "market_er_pct", headerName: "Market ER %" },
          { field: "residual_er_pct", headerName: "Residual ER %" },
        ],
      },
    },
  },
  rm_universe_members: {
    name: "RiskModels — Universe Members",
    description:
      "Active members of a named universe (universe mask AND daily validity gate) at one trading day, latest by default.",
    category: "Risk",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/universe-members",
    gridData: { w: 20, h: 16 },
    params: [
      {
        paramName: "universe",
        value: "uni_mc_3000",
        label: "Universe",
        type: "text",
        description: "Universe label from the KNOWN_UNIVERSES registry.",
        options: [
          { value: "uni_mc_50", label: "Market cap top 50" },
          { value: "uni_mc_500", label: "Market cap top 500" },
          { value: "uni_mc_1000", label: "Market cap top 1000" },
          { value: "uni_mc_3000", label: "Market cap top 3000" },
          { value: "uni_dv_50", label: "Dollar-volume top 50" },
          { value: "uni_dv_500", label: "Dollar-volume top 500" },
          { value: "uni_dv_1000", label: "Dollar-volume top 1000" },
          { value: "uni_dv_3000", label: "Dollar-volume top 3000" },
        ],
      },
      {
        paramName: "teo",
        value: "",
        label: "As-of date",
        type: "date",
        description: "Observation date (default: latest teo).",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "ticker", headerName: "Ticker" },
          { field: "symbol", headerName: "Symbol" },
        ],
      },
    },
  },
  rm_fundamentals_history: {
    name: "RiskModels — Fundamentals History (PIT)",
    description:
      "Point-in-time quarterly fundamentals: rows are visible only where filed_date <= as_of (no look-ahead). Columns marked (SEC) are raw line items served exclusively from per-cell SEC XBRL sources — '—' means that cell is vendor-sourced or unreported, never zero. Derived TTM ratios alongside. Realized historical data only.",
    category: "Fundamentals",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/fundamentals-history",
    gridData: { w: 40, h: 14 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US stock ticker.",
      },
      {
        paramName: "periods",
        value: "8",
        label: "Quarters",
        type: "text",
        description: "Number of quarters (max 40).",
        options: [
          { value: "4", label: "4" },
          { value: "8", label: "8" },
          { value: "12", label: "12" },
          { value: "20", label: "20" },
          { value: "40", label: "40" },
        ],
      },
      {
        paramName: "as_of",
        value: "",
        label: "As-of date",
        type: "date",
        description:
          "PIT anchor: only quarters filed on or before this date are visible (default: today).",
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "period_end", headerName: "Period end" },
          { field: "filed", headerName: "Filed" },
          { field: "revenue_sec", headerName: "Revenue (SEC)" },
          { field: "net_income_sec", headerName: "Net income (SEC)" },
          { field: "eps_diluted_sec", headerName: "EPS dil. (SEC)" },
          { field: "cfo_sec", headerName: "CFO (SEC)" },
          { field: "dividends_paid_sec", headerName: "Dividends paid (SEC)" },
          { field: "buybacks_sec", headerName: "Buybacks (SEC)" },
          { field: "roe_ttm", headerName: "ROE TTM" },
          { field: "fcf_margin", headerName: "FCF margin" },
          { field: "leverage", headerName: "Leverage" },
          { field: "sec_facts_served", headerName: "SEC facts" },
        ],
      },
    },
  },
  rm_fundamentals_ratios: {
    name: "RiskModels — Capital Return Ratios (TTM)",
    description:
      "Payout, retention, buyback, total-payout, and sustainable-growth ratios over time (TTM, cash-dividend basis). Null when trailing-4-quarter net income <= 0 — a payout on non-positive earnings is not meaningful, not zero. Point-in-time per quarter.",
    category: "Fundamentals",
    source: ["RiskModels API"],
    endpoint: "widgets/fundamentals-ratios",
    gridData: { w: 40, h: 12 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US stock ticker.",
      },
      {
        paramName: "periods",
        value: "16",
        label: "Quarters",
        type: "text",
        description: "Number of quarters (max 40).",
        options: [
          { value: "8", label: "8" },
          { value: "16", label: "16" },
          { value: "24", label: "24" },
          { value: "40", label: "40" },
        ],
      },
      {
        paramName: "as_of",
        value: "",
        label: "As-of date",
        type: "date",
        description:
          "PIT anchor: only quarters filed on or before this date are visible (default: today).",
      },
    ],
    data: {
      table: {
        chartView: { enabled: true, chartType: "line" },
        showAll: false,
        columnsDefs: [
          { headerName: "Period end", field: "date", chartDataType: "category" },
          { headerName: "Payout (%)", field: "Payout" },
          { headerName: "Retention (%)", field: "Retention" },
          { headerName: "Buyback (%)", field: "Buyback" },
          { headerName: "Total payout (%)", field: "Total payout" },
          { headerName: "Sustainable growth (%)", field: "Sustainable growth" },
        ],
      },
    },
  },
  rm_cost_of_capital: {
    name: "RiskModels — Cost of Capital",
    description:
      "Latest-quarter cost of equity, cost of debt, WACC (book weights), and TTM economic profit built from RiskModels conditional betas and the Treasury CMT curve. The equity risk premium is always caller-supplied via the ERP param — no ERP opinion is stored. Realized historical inputs only; not investment advice.",
    category: "Fundamentals",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/cost-of-capital",
    gridData: { w: 20, h: 14 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US stock ticker.",
      },
      {
        paramName: "erp",
        value: "0.05",
        label: "ERP",
        type: "text",
        description:
          "Equity risk premium (caller-supplied; pair short rf tenors with a bill-basis ERP).",
        options: [
          { value: "0.03", label: "3%" },
          { value: "0.04", label: "4%" },
          { value: "0.05", label: "5%" },
          { value: "0.06", label: "6%" },
          { value: "0.07", label: "7%" },
        ],
      },
      {
        paramName: "rf_tenor",
        value: "10y",
        label: "Risk-free tenor",
        type: "text",
        description: "Treasury CMT tenor for the risk-free rate (10y = valuation convention).",
        options: [
          { value: "3m", label: "3 months" },
          { value: "1y", label: "1 year" },
          { value: "2y", label: "2 years" },
          { value: "5y", label: "5 years" },
          { value: "10y", label: "10 years" },
          { value: "30y", label: "30 years" },
        ],
      },
      {
        paramName: "tax_rate",
        value: "0.21",
        label: "Tax rate",
        type: "text",
        description: "Tax rate applied to the WACC debt shield.",
        options: [
          { value: "0.15", label: "15%" },
          { value: "0.21", label: "21%" },
          { value: "0.25", label: "25%" },
          { value: "0.28", label: "28%" },
        ],
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "metric", headerName: "Metric" },
          { field: "value", headerName: "Value" },
        ],
      },
    },
  },
  rm_wacc_grid: {
    name: "RiskModels — WACC Sensitivity Grid",
    description:
      "Cost-of-capital sensitivity for the latest quarter: the selected measure across ERP rows (3–7%) and Treasury tenor columns (3m–30y). Rate measures in percent; economic profit in $B. Default measure is cost of equity (always formed from rf + beta × ERP). WACC is blank when cost of debt cannot be formed from interest/debt — AAPL is in that class.",
    category: "Fundamentals",
    type: "table",
    source: ["RiskModels API"],
    endpoint: "widgets/wacc-grid",
    gridData: { w: 20, h: 12 },
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US stock ticker.",
      },
      {
        paramName: "measure",
        value: "cost_of_equity",
        label: "Measure",
        type: "text",
        description: "Grid measure.",
        options: [
          { value: "wacc", label: "WACC (book weights)" },
          { value: "cost_of_equity", label: "Cost of equity" },
          { value: "economic_profit", label: "Economic profit ($B)" },
        ],
      },
      {
        paramName: "tax_rate",
        value: "0.21",
        label: "Tax rate",
        type: "text",
        description: "Tax rate applied to the WACC debt shield.",
        options: [
          { value: "0.15", label: "15%" },
          { value: "0.21", label: "21%" },
          { value: "0.25", label: "25%" },
          { value: "0.28", label: "28%" },
        ],
      },
    ],
    data: {
      table: {
        showAll: true,
        columnsDefs: [
          { field: "erp", headerName: "ERP \\ rf tenor" },
          { field: "3m", headerName: "3m" },
          { field: "1y", headerName: "1y" },
          { field: "2y", headerName: "2y" },
          { field: "5y", headerName: "5y" },
          { field: "10y", headerName: "10y" },
          { field: "30y", headerName: "30y" },
        ],
      },
    },
  },
  rm_model_scaffold: {
    name: "RiskModels — Model Scaffold (Excel)",
    description:
      "Download a ready-to-fill valuation-model .xlsx: the historical income/cash-flow block (revenue → EBIT → net income → FCF) plus a CAPM WACC build, filled from PIT SEC-sourced fundamentals. The block an Excel model pulls from a licensed terminal — here at $0.005/call. Forward projections stay your assumptions (RiskModels serves realized data only).",
    category: "Fundamentals",
    type: "multi_file_viewer",
    source: ["RiskModels API"],
    endpoint: "widgets/model-scaffold",
    gridData: { w: 24, h: 16 },
    staleTime: 0,
    params: [
      {
        paramName: "ticker",
        value: "AAPL",
        label: "Ticker",
        type: "text",
        description: "US equity ticker (e.g. AAPL, MSFT, NVDA).",
      },
      {
        paramName: "erp",
        value: "0.05",
        label: "Equity risk premium",
        type: "text",
        description: "Your ERP assumption for the CAPM cost of equity (default 0.05).",
      },
      {
        paramName: "periods",
        value: "8",
        label: "Quarters of history",
        type: "text",
        description: "Historical quarters to include (default 8).",
      },
      {
        paramName: "file",
        value: ["model_scaffold"],
        label: "Document",
        type: "endpoint",
        optionsEndpoint: "widgets/model-scaffold-options",
        optionsParams: { ticker: "$ticker" },
        multiSelect: true,
        roles: ["fileSelector"],
        show: false,
      },
    ],
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
    refetchInterval: 300000,
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
    refetchInterval: 300000,
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
    refetchInterval: 60000,
    params: [
      {
        paramName: "source",
        value: "manual",
        label: "Source",
        type: "text",
        description: "Manual entry, or your real ConnectTrade/Plaid-synced positions.",
        options: [
          { value: "manual", label: "Manual entry" },
          { value: "synced", label: "My synced positions (ConnectTrade/Plaid)" },
        ],
      },
      {
        paramName: "positions",
        value: "AAPL:0.4, MSFT:0.35, NVDA:0.25",
        label: "Positions",
        type: "text",
        description:
          "Comma-separated ticker:weight (e.g. AAPL:0.4, MSFT:0.35, NVDA:0.25). Weights auto-normalise; bare tickers = equal weight. Ignored when Source is set to synced.",
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
    refetchInterval: 60000,
    params: [
      {
        paramName: "source",
        value: "manual",
        label: "Source",
        type: "text",
        description: "Manual entry, or your real ConnectTrade/Plaid-synced positions.",
        options: [
          { value: "manual", label: "Manual entry" },
          { value: "synced", label: "My synced positions (ConnectTrade/Plaid)" },
        ],
      },
      {
        paramName: "positions",
        value: "AAPL:0.4, MSFT:0.35, NVDA:0.25",
        label: "Positions",
        type: "text",
        description: "Comma-separated ticker:weight. Ignored when Source is set to synced.",
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
