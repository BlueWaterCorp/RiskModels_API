/**
 * Live widget: valuation-model Excel scaffold -> OpenBB `multi_file_viewer`.
 *
 * GET or POST /openbb/widgets/model-scaffold
 * OpenBB Workspace POSTs the fileSelector list in the JSON body. GET query
 * params still work. Fetches the real server-built .xlsx from
 * /fundamentals/{ticker}/model-scaffold, base64-encodes it, and returns the
 * multi_file_viewer array contract.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGetBytes } from "../../_lib/upstream";
import {
  namesMatch,
  readWidgetInput,
  selectedNames,
} from "../../_lib/widget-request";

export const dynamic = "force-dynamic";

const FILE_ALIASES = ["model_scaffold", "Valuation Model Scaffold"] as const;

async function handle(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = await readWidgetInput(req);
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const erp = sp.get("erp") || "0.05";
  const periods = sp.get("periods") || "8";
  const files = selectedNames(sp, "file", "model_scaffold");

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

  if (!namesMatch(files, FILE_ALIASES)) {
    return NextResponse.json(
      files.map((name) => ({
        error_type: "not_found",
        content: `File '${name}' is not a RiskModels model scaffold`,
      })),
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

export const GET = handle;
export const POST = handle;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
