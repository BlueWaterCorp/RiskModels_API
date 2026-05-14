import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { readEtfHoldingsTopN } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/:ticker
 *
 * Latest knowledge-mode metrics for a single ETF — registry-level metadata
 * (portfolio_id, ticker, source_kind, teo_frequency, sponsor) + the latest
 * aggregate metrics from the canonical PortfolioSurface zarr (aum_reported,
 * aum_erm3, coverage_pct, n_total_holdings, report_date, availability_date).
 *
 * Symmetric to `/api/data/funds/:bw_fund_id` and `/api/13f/filers/:bw_filer_id`
 * — closes the "base entity metrics" parity gap for the ETF surface.
 * MASTER_BACKLOG L.6 / D.9.
 *
 * Bitemporal lineage on response headers — never collapsed:
 *   X-Data-As-Of:           report_date    (sponsor's "Fund Holdings as of")
 *   X-Data-Availability:    availability_date (when that file was observed)
 *
 * No per-holding rows — call `/api/data/etf/:ticker/holdings` for those.
 * Soft gateway auth (public read). 404 when no zarr or empty.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { ticker } = await params;
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  // n=0 → the metrics shell with an empty holdings array; we strip the array.
  const snapshot = await readEtfHoldingsTopN(ticker, 1);
  if (!snapshot) {
    return NextResponse.json(
      { error: "ETF not found or no holdings available" },
      { status: 404 },
    );
  }

  const headers = new Headers();
  headers.set("X-Data-As-Of", snapshot.report_date);
  if (snapshot.availability_date) {
    headers.set("X-Data-Availability", snapshot.availability_date);
  }

  // Strip the holdings array — callers wanting top-N use /holdings.
  const { holdings: _holdings, n_holdings_returned: _n, ...metrics } = snapshot;
  return NextResponse.json(metrics, { headers });
}
