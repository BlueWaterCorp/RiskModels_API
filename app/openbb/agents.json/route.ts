/**
 * agents.json — OpenBB Workspace AI agent discovery.
 *
 * Registers the RiskModels Analyst: an OpenBB-protocol copilot agent whose
 * `/query` endpoint (POST → SSE) proxies to our existing tool-calling chat
 * agent (`/api/chat`, Claude + the RiskModels risk tools). Per-user key
 * passthrough — same `X-API-KEY` the backend connection carries.
 *
 * The query URL is derived from the request host so it works whether reached at
 * `riskmodels.app/openbb` or a future `openbb.riskmodels.app` rewrite.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../_lib/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const queryUrl = `${u.protocol}//${u.host}/openbb/query`;

  const agents = {
    "riskmodels-analyst": {
      name: "RiskModels Analyst",
      description:
        "Institutional risk analyst — hedge layering, L1/L2/L3 factor decomposition, cross-sectional rankings, residual signal, and portfolio hedging across US equities and ETFs. Answers with real RiskModels data and shows the tools it used.",
      image: `${u.protocol}//${u.host}/logo.png`,
      endpoints: { query: queryUrl },
      features: { streaming: true },
    },
  };

  return NextResponse.json(agents, { headers: openbbCors(req) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
