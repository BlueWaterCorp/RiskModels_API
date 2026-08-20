/**
 * Shared OpenBB Workspace App / Template definitions.
 *
 * OpenBB's "Connect backend" probe fetches BOTH `apps.json` and `templates.json`
 * during the connect-test (confirmed in Vercel logs 2026-06-30: a 404 on
 * templates.json returns an HTML page, which OpenBB's backend JSON.parse chokes
 * on → generic 500 in the Connect dialog). "Apps" and "templates" are the same
 * concept in Workspace, so both routes serve this single array — whichever the
 * running Workspace version consumes, the dashboard appears and neither 404s.
 *
 * Three-app set (Single-Name Risk, Screener, Portfolio Risk & Hedge — E.21/
 * E.23) with every live widget slotted into a tab, `groups` param-sync across
 * widgets that share an input, `prompts` surfacing @[id:WIDGET_ID] mentions
 * for the RiskModels Analyst copilot, and `selected_agent` defaulting each
 * app's chat to that agent. Layout coords are best-effort and get tuned on
 * first connect against the live Workspace grid.
 */
type AppLayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state?: { params: Record<string, string | string[]> };
};

type AppTab = { id: string; name: string; layout: AppLayoutItem[] };

type AppParamGroup = {
  name: string;
  type: "param";
  paramName: string;
  defaultValue: string;
  widgetIds: string[];
};

export type WorkspaceApp = {
  name: string;
  img?: string;
  img_dark?: string;
  img_light?: string;
  description: string;
  allowCustomization: boolean;
  selected_agent: string;
  prompts: string[];
  tabs: Record<string, AppTab>;
  groups?: AppParamGroup[];
};

const ASSETS = "https://riskmodels.app/openbb-assets";

/** Same cover for light/dark — the mounted-plate dark card reads on both. */
function cover(file: string) {
  return {
    img: `${ASSETS}/${file}`,
    img_dark: `${ASSETS}/${file}`,
    img_light: `${ASSETS}/${file}`,
  };
}

export const APPS: WorkspaceApp[] = [
  // Flagship — the ONE listable marketplace app (E.23 re-scope: visibility is
  // apps-only). Composes every live widget across five tabs; the three
  // focused apps below remain for existing users and deep links.
  {
    name: "RiskModels",
    ...cover("app-riskmodels.png"),
    description:
      "Decomposed equity risk and point-in-time fundamentals for US equities. Single-name risk (L1/L2/L3 hedge layering, explained risk, residual signal), PIT quarterly fundamentals with per-cell SEC provenance, cost of capital with your own ERP assumption, multi-position portfolio risk with broker-synced positions, cross-sectional screening, and a PDF tearsheet — plus the RiskModels Analyst copilot on the same live tools.",
    allowCustomization: true,
    selected_agent: "riskmodels-analyst",
    prompts: [
      "What's driving @[id:rm_single_name_metrics]'s risk for AAPL?",
      "Summarize the fundamentals trend in @[id:rm_fundamentals_history] — which line items are SEC-sourced?",
      "Walk me through @[id:rm_cost_of_capital] and how sensitive WACC is to my ERP assumption in @[id:rm_wacc_grid].",
      "How would I hedge this position based on @[id:rm_single_name_snapshot]?",
      "Summarize this portfolio's risk from @[id:rm_portfolio_risk].",
      "Rank the universe by market cap using @[id:rm_rankings_top].",
    ],
    tabs: {
      overview: {
        id: "overview",
        name: "Overview",
        layout: [
          {
            i: "rm_single_name_metrics",
            x: 0,
            y: 0,
            w: 20,
            h: 12,
            state: { params: { ticker: "AAPL" } },
          },
          {
            i: "rm_single_name_snapshot",
            x: 20,
            y: 0,
            w: 20,
            h: 20,
            state: { params: { ticker: "AAPL" } },
          },
          {
            i: "rm_cumulative_return",
            x: 0,
            y: 20,
            w: 40,
            h: 12,
            state: { params: { ticker: "AAPL", years: "1" } },
          },
          {
            i: "rm_risk_composition",
            x: 0,
            y: 32,
            w: 40,
            h: 12,
            state: { params: { ticker: "AAPL", years: "1" } },
          },
        ],
      },
      fundamentals: {
        id: "fundamentals",
        name: "Fundamentals",
        layout: [
          {
            i: "rm_fundamentals_history",
            x: 0,
            y: 0,
            w: 40,
            h: 14,
            state: { params: { ticker: "AAPL", periods: "8" } },
          },
          {
            i: "rm_fundamentals_ratios",
            x: 0,
            y: 14,
            w: 40,
            h: 12,
            state: { params: { ticker: "AAPL", periods: "16" } },
          },
          {
            i: "rm_cost_of_capital",
            x: 0,
            y: 26,
            w: 20,
            h: 14,
            state: { params: { ticker: "AAPL", erp: "0.05", rf_tenor: "10y" } },
          },
          {
            i: "rm_wacc_grid",
            x: 20,
            y: 26,
            w: 20,
            h: 14,
            state: { params: { ticker: "AAPL", measure: "cost_of_equity" } },
          },
          {
            i: "rm_model_scaffold",
            x: 0,
            y: 40,
            w: 40,
            h: 16,
            state: { params: { ticker: "AAPL", erp: "0.05", periods: "8" } },
          },
        ],
      },
      portfolio: {
        id: "portfolio",
        name: "Portfolio",
        layout: [
          {
            i: "rm_portfolio_risk",
            x: 0,
            y: 0,
            w: 40,
            h: 14,
            state: { params: { positions: "AAPL:0.4, MSFT:0.35, NVDA:0.25" } },
          },
          {
            i: "rm_portfolio_positions",
            x: 0,
            y: 14,
            w: 40,
            h: 14,
            state: { params: { positions: "AAPL:0.4, MSFT:0.35, NVDA:0.25" } },
          },
        ],
      },
      screener: {
        id: "screener",
        name: "Screener",
        layout: [
          {
            i: "rm_rankings_top",
            x: 0,
            y: 0,
            w: 24,
            h: 16,
            state: {
              params: {
                metric: "mkt_cap",
                cohort: "universe",
                window: "1d",
                limit: "25",
              },
            },
          },
          {
            i: "rm_etf_factor_returns",
            x: 24,
            y: 0,
            w: 16,
            h: 16,
            state: { params: { sleeve: "all" } },
          },
        ],
      },
      tearsheet: {
        id: "tearsheet",
        name: "Tearsheet",
        layout: [
          {
            i: "rm_tearsheet",
            x: 0,
            y: 0,
            w: 40,
            h: 24,
            state: { params: { ticker: "AAPL" } },
          },
        ],
      },
    },
    groups: [
      {
        name: "ticker",
        type: "param",
        paramName: "ticker",
        defaultValue: "AAPL",
        widgetIds: [
          "rm_single_name_metrics",
          "rm_single_name_snapshot",
          "rm_cumulative_return",
          "rm_risk_composition",
          "rm_fundamentals_history",
          "rm_fundamentals_ratios",
          "rm_cost_of_capital",
          "rm_wacc_grid",
          "rm_model_scaffold",
          "rm_tearsheet",
        ],
      },
      {
        name: "positions",
        type: "param",
        paramName: "positions",
        defaultValue: "AAPL:0.4, MSFT:0.35, NVDA:0.25",
        widgetIds: ["rm_portfolio_risk", "rm_portfolio_positions"],
      },
      {
        name: "source",
        type: "param",
        paramName: "source",
        defaultValue: "manual",
        widgetIds: ["rm_portfolio_risk", "rm_portfolio_positions"],
      },
    ],
  },
  {
    name: "RiskModels — Single-Name Risk",
    ...cover("app-single-name.png"),
    description:
      "Hedge layering, volatility, and residual signal for one ticker, powered by the RiskModels API.",
    allowCustomization: true,
    selected_agent: "riskmodels-analyst",
    prompts: [
      "What's driving @[id:rm_single_name_metrics]'s risk for AAPL?",
      "Walk me through the L3 explained-risk composition over time in @[id:rm_risk_composition].",
      "How would I hedge this position based on @[id:rm_single_name_snapshot]?",
      "How does this ticker rank cross-sectionally per @[id:rm_rankings_single]?",
      "Summarize the fundamentals trend in @[id:rm_fundamentals_history] — which line items are SEC-sourced?",
      "Is this company returning or reinvesting capital, per @[id:rm_fundamentals_ratios]?",
      "Walk me through @[id:rm_cost_of_capital] and how sensitive WACC is to my ERP assumption in @[id:rm_wacc_grid].",
    ],
    tabs: {
      overview: {
        id: "overview",
        name: "Overview",
        layout: [
          {
            i: "rm_single_name_metrics",
            x: 0,
            y: 0,
            w: 20,
            h: 12,
            state: { params: { ticker: "AAPL" } },
          },
          {
            i: "rm_single_name_snapshot",
            x: 20,
            y: 0,
            w: 20,
            h: 20,
            state: { params: { ticker: "AAPL" } },
          },
          {
            i: "rm_cumulative_return",
            x: 0,
            y: 20,
            w: 40,
            h: 12,
            state: { params: { ticker: "AAPL", years: "1" } },
          },
          {
            i: "rm_risk_composition",
            x: 0,
            y: 32,
            w: 40,
            h: 12,
            state: { params: { ticker: "AAPL", years: "1" } },
          },
          {
            i: "rm_rankings_single",
            x: 0,
            y: 44,
            w: 24,
            h: 14,
            state: { params: { ticker: "AAPL" } },
          },
        ],
      },
      fundamentals: {
        id: "fundamentals",
        name: "Fundamentals",
        layout: [
          {
            i: "rm_fundamentals_history",
            x: 0,
            y: 0,
            w: 40,
            h: 14,
            state: { params: { ticker: "AAPL", periods: "8" } },
          },
          {
            i: "rm_fundamentals_ratios",
            x: 0,
            y: 14,
            w: 40,
            h: 12,
            state: { params: { ticker: "AAPL", periods: "16" } },
          },
          {
            i: "rm_cost_of_capital",
            x: 0,
            y: 26,
            w: 20,
            h: 14,
            state: { params: { ticker: "AAPL", erp: "0.05", rf_tenor: "10y" } },
          },
          {
            i: "rm_wacc_grid",
            x: 20,
            y: 26,
            w: 20,
            h: 14,
            state: { params: { ticker: "AAPL", measure: "cost_of_equity" } },
          },
        ],
      },
      tearsheet: {
        id: "tearsheet",
        name: "Tearsheet",
        layout: [
          {
            i: "rm_tearsheet",
            x: 0,
            y: 0,
            w: 40,
            h: 24,
            state: { params: { ticker: "AAPL" } },
          },
        ],
      },
    },
    groups: [
      // Change the ticker in one widget → the whole app follows (all tabs).
      {
        name: "ticker",
        type: "param",
        paramName: "ticker",
        defaultValue: "AAPL",
        widgetIds: [
          "rm_single_name_metrics",
          "rm_single_name_snapshot",
          "rm_cumulative_return",
          "rm_risk_composition",
          "rm_rankings_single",
          "rm_fundamentals_history",
          "rm_fundamentals_ratios",
          "rm_cost_of_capital",
          "rm_wacc_grid",
          "rm_tearsheet",
        ],
      },
    ],
  },
  {
    name: "RiskModels — Screener",
    ...cover("app-screener.png"),
    description:
      "Cross-sectional rankings, universe membership, factor-ETF returns, ETF holdings, and 13F filer holdings, powered by the RiskModels API.",
    allowCustomization: true,
    selected_agent: "riskmodels-analyst",
    prompts: [
      "Rank the universe by market cap using @[id:rm_rankings_top].",
      "Which names are currently active members of uni_mc_3000 per @[id:rm_universe_members]?",
      "Compare sector-ETF trailing returns using @[id:rm_etf_factor_returns].",
      "What are IVV's top holdings per @[id:rm_etf_holdings]?",
      "Summarize a 13F filer's top positions from @[id:rm_filer_holdings].",
    ],
    tabs: {
      screen: {
        id: "screen",
        name: "Screener",
        layout: [
          {
            i: "rm_rankings_top",
            x: 0,
            y: 0,
            w: 24,
            h: 16,
            state: {
              params: {
                metric: "mkt_cap",
                cohort: "universe",
                window: "1d",
                limit: "10",
              },
            },
          },
        ],
      },
      universe: {
        id: "universe",
        name: "Universe",
        layout: [
          {
            i: "rm_universe_members",
            x: 0,
            y: 0,
            w: 20,
            h: 16,
            state: { params: { universe: "uni_mc_3000" } },
          },
        ],
      },
      etf: {
        id: "etf",
        name: "ETFs",
        layout: [
          {
            i: "rm_etf_factor_returns",
            x: 0,
            y: 0,
            w: 40,
            h: 12,
            state: { params: { sleeve: "all" } },
          },
          {
            i: "rm_etf_holdings",
            x: 0,
            y: 12,
            w: 24,
            h: 14,
            state: { params: { ticker: "IVV", top: "25" } },
          },
        ],
      },
      filers: {
        id: "filers",
        name: "13F Filers",
        layout: [
          {
            i: "rm_filer_holdings",
            x: 0,
            y: 0,
            w: 24,
            h: 14,
            state: { params: { limit: "25" } },
          },
        ],
      },
    },
  },
  {
    name: "RiskModels — Portfolio Risk & Hedge",
    ...cover("app-portfolio.png"),
    description:
      "Multi-position portfolio: L3 explained-risk decomposition, L1/L2/L3 hedge layering, and a per-position breakdown, powered by the RiskModels API.",
    allowCustomization: true,
    selected_agent: "riskmodels-analyst",
    prompts: [
      "Summarize this portfolio's risk from @[id:rm_portfolio_risk].",
      "Which positions in @[id:rm_portfolio_positions] carry the most residual risk?",
      "How would L1/L2/L3 hedge layering change if I trimmed the largest position?",
    ],
    tabs: {
      portfolio: {
        id: "portfolio",
        name: "Portfolio",
        layout: [
          {
            i: "rm_portfolio_risk",
            x: 0,
            y: 0,
            w: 40,
            h: 16,
            state: { params: { positions: "AAPL:0.4, MSFT:0.35, NVDA:0.25" } },
          },
        ],
      },
      hedge: {
        id: "hedge",
        name: "Hedge",
        layout: [
          {
            i: "rm_portfolio_positions",
            x: 0,
            y: 0,
            w: 40,
            h: 16,
            state: { params: { positions: "AAPL:0.4, MSFT:0.35, NVDA:0.25" } },
          },
        ],
      },
    },
    groups: [
      // One positions box drives both widgets across both tabs.
      {
        name: "positions",
        type: "param",
        paramName: "positions",
        defaultValue: "AAPL:0.4, MSFT:0.35, NVDA:0.25",
        widgetIds: ["rm_portfolio_risk", "rm_portfolio_positions"],
      },
      // Flipping to synced positions (E.23 B.6) applies to both tabs too.
      {
        name: "source",
        type: "param",
        paramName: "source",
        defaultValue: "manual",
        widgetIds: ["rm_portfolio_risk", "rm_portfolio_positions"],
      },
    ],
  },
];
