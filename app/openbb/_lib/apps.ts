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
export const APPS = [
  {
    name: "RiskModels — Single-Name Risk",
    description:
      "Hedge layering, volatility, and residual signal for one ticker, powered by the RiskModels API.",
    allowCustomization: true,
    selected_agent: "riskmodels-analyst",
    prompts: [
      "What's driving @[id:rm_single_name_metrics]'s risk for AAPL?",
      "Walk me through the L3 explained-risk composition over time in @[id:rm_risk_composition].",
      "How would I hedge this position based on @[id:rm_single_name_snapshot]?",
      "How does this ticker rank cross-sectionally per @[id:rm_rankings_single]?",
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
            state: { params: { ticker: "AAPL", file: ["risk_snapshot"] } },
          },
        ],
      },
    },
    groups: [
      // Change the ticker in one widget → the whole app follows (both tabs).
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
          "rm_tearsheet",
        ],
      },
    ],
  },
  {
    name: "RiskModels — Screener",
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
