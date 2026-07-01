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
 * Skeleton ships one app containing the live metrics widget so the
 * connect-and-render path is exercised end to end. The full three-app set
 * (Single-Name Risk, Portfolio Risk & Hedge, Screener — see E.21) lands as
 * each widget's data endpoint is wired. Layout coords are best-effort and get
 * tuned on first connect against the live Workspace grid.
 */
export const APPS = [
  {
    name: "RiskModels — Single-Name Risk",
    description:
      "Hedge layering, volatility, and residual signal for one ticker, powered by the RiskModels API.",
    allowCustomization: true,
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
    },
    groups: [
      // Change the ticker in one widget → the whole tab follows.
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
        ],
      },
    ],
  },
  {
    name: "RiskModels — Screener",
    description:
      "Cross-sectional rankings — top names by explained-risk, residual, return, and market cap across universe/sector/subsector cohorts.",
    allowCustomization: true,
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
    },
  },
];
