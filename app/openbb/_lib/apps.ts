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
        ],
      },
    },
    groups: [
      // Wire the ticker param across widgets once >1 widget is live, so changing
      // the ticker in one updates the whole tab.
      {
        name: "ticker",
        type: "param",
        paramName: "ticker",
        defaultValue: "AAPL",
        widgetIds: ["rm_single_name_metrics", "rm_single_name_snapshot"],
      },
    ],
  },
];
