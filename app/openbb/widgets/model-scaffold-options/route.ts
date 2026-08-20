/**
 * optionsEndpoint for the model-scaffold multi_file_viewer fileSelector.
 *
 * GET /openbb/widgets/model-scaffold-options?ticker=AAPL
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import {
  tickerScopedFileValue,
  WIDGET_NO_STORE,
} from "../../_lib/widget-request";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL")
    .trim()
    .toUpperCase();
  return NextResponse.json(
    [
      {
        label: "Valuation Model Scaffold",
        value: tickerScopedFileValue(ticker, "model_scaffold"),
      },
    ],
    { headers: { ...openbbCors(req), ...WIDGET_NO_STORE } },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
