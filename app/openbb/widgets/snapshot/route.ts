/**
 * Live widget data endpoint: institutional risk-snapshot tearsheet → OpenBB
 * `pdf` (file viewer) widget.
 *
 * GET /openbb/widgets/snapshot?ticker=AAPL
 * Auth: X-API-KEY header (forwarded upstream as Bearer). Fetches the real
 * server-rendered PDF from /metrics/{ticker}/snapshot.pdf, base64-encodes it,
 * and returns the OpenBB file-viewer contract so the tearsheet renders inline.
 * No synthetic content — whatever the API renders is what shows.
 */
import { NextRequest, NextResponse } from "next/server";
import { snapshotConnectProbe } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGetBytes } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cors = openbbCors(req.headers.get("origin"));
  // OpenBB widget validation probes endpoints without query params; default to
  // the same ticker declared in widgets.json params[].value.
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL")
    .trim()
    .toUpperCase();

  const key = bearerFromRequest(req);
  if (!key) {
    return NextResponse.json(snapshotConnectProbe(ticker), { headers: cors });
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
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const content = Buffer.from(bytes).toString("base64");
  return NextResponse.json(
    {
      data_format: {
        data_type: "pdf",
        filename: `${ticker}_risk_snapshot.pdf`,
      },
      content,
    },
    { headers: cors },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req.headers.get("origin")),
  });
}
