/**
 * Live widget: institutional risk-snapshot tearsheet -> OpenBB
 * `multi_file_viewer` widget (retry of the `pdf` widget type, which OpenBB's
 * pdf.js viewer failed to render — see app/openbb/README.md, issue #194).
 *
 * GET or POST /openbb/widgets/tearsheet
 * OpenBB Workspace POSTs the fileSelector list in the JSON body
 * (`{ file: ["IBM_risk_snapshot"], ticker: "IBM" }`). The file id is
 * ticker-scoped so Workspace does not keep serving a cached AAPL PDF after
 * the grouped ticker changes. Bare `risk_snapshot` still works. GET query
 * params still work.
 * Fetches the real server-rendered PDF from /metrics/{ticker}/snapshot.pdf,
 * base64-encodes it, and returns the multi_file_viewer array contract.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGetBytes } from "../../_lib/upstream";
import {
  isFileSelection,
  readWidgetInput,
  selectedNames,
  WIDGET_NO_STORE,
} from "../../_lib/widget-request";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const cors = { ...openbbCors(req), ...WIDGET_NO_STORE };
  const sp = await readWidgetInput(req);
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const files = selectedNames(sp, "file", "risk_snapshot");

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

  if (!isFileSelection(files, "risk_snapshot", ["Risk Snapshot Tearsheet"])) {
    return NextResponse.json(
      files.map((name) => ({
        error_type: "not_found",
        content: `File '${name}' is not a RiskModels tearsheet`,
      })),
      { headers: cors },
    );
  }

  const { status, bytes, error } = await upstreamGetBytes(
    `/metrics/${encodeURIComponent(ticker)}/snapshot.pdf`,
    key,
  );

  if (!bytes) {
    const message =
      (error as { error?: string; message?: string })?.error ||
      (error as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json(
      [{ error_type: "fetch_failed", content: message }],
      { status, headers: cors },
    );
  }

  const content = Buffer.from(bytes).toString("base64");
  return NextResponse.json(
    [
      {
        data_format: {
          data_type: "pdf",
          filename: `${ticker}_risk_snapshot.pdf`,
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
