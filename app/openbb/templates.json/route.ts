/**
 * templates.json — OpenBB Workspace dashboard templates.
 *
 * OpenBB's "Connect backend" probe fetches this file during the connect-test.
 * When it was absent, the request fell through to Next.js's 404 *HTML* page;
 * OpenBB's backend then JSON.parse'd that HTML, threw, and surfaced a generic
 * 500 in the Connect dialog (confirmed in Vercel logs 2026-06-30:
 * `GET /openbb/templates.json -> 404`). "Apps" and "templates" are the same
 * concept in Workspace, so this serves the same array as apps.json.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../_lib/cors";
import { APPS } from "../_lib/apps";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(APPS, {
    headers: openbbCors(req.headers.get("origin")),
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req.headers.get("origin")),
  });
}
