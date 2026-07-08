/**
 * Live widget: institutional risk-snapshot tearsheet -> OpenBB
 * `multi_file_viewer` widget (retry of the `pdf` widget type, which OpenBB's
 * pdf.js viewer failed to render — see app/openbb/README.md, issue #194).
 *
 * GET /openbb/widgets/tearsheet?ticker=AAPL&file=risk_snapshot
 * Fetches the real server-rendered PDF from /metrics/{ticker}/snapshot.pdf,
 * base64-encodes it, and returns the multi_file_viewer array contract. No
 * synthetic content — whatever the API renders is what shows.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGetBytes } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  // OpenBB widget validation probes endpoints without query params; default to
  // the same ticker declared in widgets.json params[].value.
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL")
    .trim()
    .toUpperCase();

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

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
