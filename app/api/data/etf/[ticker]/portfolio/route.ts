import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { readSurfacePortfolioSeries, tickerToBwEtfId } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/:ticker/portfolio?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * An ETF's L1/L2/L3 return-decomposition time series (Funds_DAG
 * `surface_portfolios_zarr` — same schema as `/api/funds/{bw_fund_id}/portfolio`:
 * `portfolio_{gross,market,sector,subsector,idiosyncratic}_return`,
 * `identity_residual`, `weight_sum`, `n_holdings_active`, `effective_n`,
 * `top10_weight_sum`). `weight_basis` is reported in the response: v1 =
 * `latest_holdings_constant` (the factor profile of the ETF's *current*
 * composition over ERM3 monthly's full history). `variance_shares` carries the
 * diversification-credited full-window market/sector/subsector/residual shares.
 * Soft gateway auth (public read). 404 when the ETF has no `ds_portfolio.zarr`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { ticker } = await params;
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const url = new URL(request.url);
  const startDate = url.searchParams.get("start_date")?.trim() || undefined;
  const endDate = url.searchParams.get("end_date")?.trim() || undefined;
  for (const d of [startDate, endDate]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ error: "start_date / end_date must be YYYY-MM-DD" }, { status: 400 });
    }
  }

  const series = await readSurfacePortfolioSeries(tickerToBwEtfId(ticker), { startDate, endDate });
  if (!series) return NextResponse.json({ error: "ETF not found or no portfolio decomposition available" }, { status: 404 });

  const headers = new Headers();
  if (series.n_rows > 0) headers.set("X-Data-As-Of", series.rows[series.n_rows - 1]!.teo);
  return NextResponse.json({ ticker: ticker.trim().toUpperCase(), ...series }, { headers });
}
