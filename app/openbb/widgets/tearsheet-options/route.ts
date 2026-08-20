/**
 * optionsEndpoint for the tearsheet multi_file_viewer widget's fileSelector
 * param. There is exactly one document type today (the single-name risk
 * snapshot PDF); this list exists so the widget conforms to the
 * multi_file_viewer contract (fileSelector param backed by optionsEndpoint)
 * and can grow additional report types later without a schema change.
 *
 * GET /openbb/widgets/tearsheet-options?ticker=AAPL
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
        label: "Risk Snapshot Tearsheet",
        value: tickerScopedFileValue(ticker, "risk_snapshot"),
      },
    ],
    { headers: { ...openbbCors(req), ...WIDGET_NO_STORE } },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
