import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

const DATA_DIR = join(process.cwd(), "mcp", "data");

/**
 * GET /.well-known/agent-manifest.json — agent discovery (MCP resource + installers).
 */
export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  let capabilities: unknown[] | undefined;
  const capPath = join(DATA_DIR, "capabilities.json");
  if (existsSync(capPath)) {
    try {
      capabilities = JSON.parse(readFileSync(capPath, "utf-8")) as unknown[];
    } catch {
      capabilities = undefined;
    }
  }
  const payload = {
    service: {
      name: "RiskModels",
      version: "2.0.0-agent",
      base_url: base,
      openapi_url: `${base}/openapi.json`,
      mcp_sse_url: `${base}/api/mcp/sse`,
    },
    capabilities: capabilities ?? [],
  };
  return NextResponse.json(payload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
