/**
 * OpenBB Workspace custom-backend root.
 *
 * Connect this backend in OpenBB Workspace via "Add data" → base URL
 * `https://riskmodels.app/openbb` (the subdomain openbb.riskmodels.app maps
 * here via a Vercel domain rewrite). Auth: add an `X-API-KEY` header set to
 * your `rm_agent_live_*` key.
 *
 * Backlog: E.21.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "./_lib/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      name: "RiskModels — OpenBB Workspace backend",
      description:
        "Institutional single-name and portfolio risk: L1/L2/L3 hedge layering, residual signal, rankings, and institutional snapshot tearsheets.",
      version: "0.1.0",
      widgets: "/openbb/widgets.json",
      apps: "/openbb/apps.json",
      docs: "https://riskmodels.app/docs",
    },
    { headers: openbbCors(req.headers.get("origin")) },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req.headers.get("origin")),
  });
}
