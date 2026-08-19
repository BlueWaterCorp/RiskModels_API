/**
 * optionsEndpoint for the model-scaffold multi_file_viewer widget's
 * fileSelector param. There is exactly one document type today (the
 * valuation-model .xlsx); this list exists so the widget conforms to
 * OpenBB's multi_file_viewer contract (a param with roles: ["fileSelector"]
 * backed by optionsEndpoint).
 *
 * GET /openbb/widgets/model-scaffold-options?ticker=AAPL
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(
    [{ label: "Valuation Model Scaffold", value: "model_scaffold" }],
    { headers: openbbCors(req) },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
