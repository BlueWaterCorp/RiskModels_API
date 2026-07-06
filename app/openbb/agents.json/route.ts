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
      // NOTE: in OpenBB multi-orchestrator mode the main Copilot uses this
      // description to decide when to route a query here, and it renders as the
      // welcome message in empty chats — so it leads with capabilities + use
      // cases (not "free demo"), which is what makes non-MAG7 questions route to
      // this agent instead of falling through to the default OpenBB Copilot.
      description:
        "RiskModels institutional equity risk analyst. Decomposes any US stock or portfolio into market, sector, subsector, and stock-specific (residual/idiosyncratic) risk — position-up L1/L2/L3 factor decomposition with tradeable hedge ratios, residual (Lstar) signal, and cross-sectional rankings. Use it to answer what is driving a name's or portfolio's risk, how to hedge a specific exposure, how idiosyncratic a position is, or how a stock ranks on factor and residual risk. Free for the Magnificent 7 (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA); add your riskmodels.app API key as X-API-KEY for the full US universe and multi-position portfolio hedging.",
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
