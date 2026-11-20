import { NextRequest, NextResponse } from "next/server";
import { finosCors } from "../_lib/cors";
import { FINOS_APPS } from "../_lib/manifests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(FINOS_APPS, { headers: finosCors(req) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: finosCors(req) });
}
