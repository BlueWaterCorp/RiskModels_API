/**
 * agents.json — empty stub for OpenBB unified "Connect backend" probes.
 *
 * Data-only backends have no custom agent yet (E.21 follow-up: npm riskmodels
 * MCP). Returning {} avoids 404 HTML during connect-test; agents are added
 * separately when wired.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../_lib/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({}, { headers: openbbCors(req.headers.get("origin")) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req.headers.get("origin")),
  });
}
