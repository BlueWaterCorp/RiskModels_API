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
    endpoint: "openbb/widgets/metrics",
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
    name: "RiskModels — Risk Snapshot Tearsheet",
    description:
      "Institutional one-page risk tearsheet (PDF): L3 explained-risk decomposition, portfolio volatility, and position-level hedge ratios for one ticker.",
    category: "Risk",
    type: "pdf",
    endpoint: "openbb/widgets/snapshot",
    gridData: { w: 20, h: 20 },
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
} as const;

export async function GET(req: NextRequest) {
  return NextResponse.json(WIDGETS, {
    headers: openbbCors(req.headers.get("origin")),
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req.headers.get("origin")),
  });
}
