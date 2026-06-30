/**
 * apps.json — OpenBB Workspace App definitions.
 *
 * Shared with templates.json (see ../_lib/apps.ts): OpenBB's connect-test probes
 * both files, so both serve the same array.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../_lib/cors";
import { APPS } from "../_lib/apps";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(APPS, {
    headers: openbbCors(req),
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
