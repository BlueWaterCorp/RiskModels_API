import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/mcp.json — MCP discovery manifest (site origin, not under /api).
 */
export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  const sseUrl = `${base}/api/mcp/sse`;
  const payload = {
    mcpServers: {
      riskmodels: {
        name: "RiskModels API",
        description: "US equity factor risk, hedge ratios, and portfolio snapshots.",
        url: sseUrl,
        transport: "sse",
        auth: {
          type: "bearer",
          header: "Authorization",
          prefix: "Bearer ",
        },
        capabilities: {
          tools: true,
          resources: true,
        },
      },
    },
    _documentation: {
      note: "Use POST on the MCP Streamable HTTP endpoint with Accept: application/json, text/event-stream",
      sse_post: sseUrl,
    },
  };
  return NextResponse.json(payload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
