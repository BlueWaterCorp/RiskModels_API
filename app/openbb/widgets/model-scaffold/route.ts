/**
 * Live widget: valuation-model Excel scaffold -> OpenBB `multi_file_viewer`.
 *
 * GET /openbb/widgets/model-scaffold?ticker=AAPL&erp=0.05&periods=8
 * Fetches the real server-built .xlsx from /fundamentals/{ticker}/model-scaffold
 * (historical income/CF block + CAPM WACC build, SEC-sourced, PIT), base64-encodes
 * it, and returns the multi_file_viewer download contract. No synthetic content —
 * whatever the API builds is what downloads. Forward projections stay the user's
 * own assumptions (RiskModels serves realized data only).
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGetBytes } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const erp = sp.get("erp") || "0.05";
  const periods = sp.get("periods") || "8";

  const key = bearerFromRequest(req);
  if (!key) {
    return NextResponse.json(
      [
        {
          error_type: "unauthorized",
          content: "Add X-API-KEY (rm_agent_live_*) in OpenBB Connections to load data",
        },
      ],
      { headers: cors },
    );
  }

  const path = `/fundamentals/${encodeURIComponent(ticker)}/model-scaffold?erp=${encodeURIComponent(
    erp,
  )}&periods=${encodeURIComponent(periods)}`;
  const { status, bytes, error } = await upstreamGetBytes(path, key);

  if (!bytes) {
    const message =
      (error as { error?: string; message?: string })?.error ||
      (error as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json([{ error_type: "fetch_failed", content: message }], {
      status,
      headers: cors,
    });
  }

  const content = Buffer.from(bytes).toString("base64");
  return NextResponse.json(
    [
      {
        data_format: {
          data_type: "xlsx",
          filename: `${ticker}_model_scaffold.xlsx`,
        },
        content,
      },
    ],
    { headers: cors },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
