/**
 * prompts.json — empty stub for OpenBB unified "Connect backend" probes.
 *
 * Prompt libraries live in apps.json today; this endpoint satisfies connect-test
 * fetches without a 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../_lib/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({}, { headers: openbbCors(req) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
