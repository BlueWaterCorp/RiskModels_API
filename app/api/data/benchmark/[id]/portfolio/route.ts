import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { readSurfacePortfolioSeries, resolveBenchmarkId } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/benchmark/:id/portfolio?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * A benchmark's L1/L2/L3 return-decomposition time series (Funds_DAG
 * `surface_portfolios_zarr` — same schema as `/api/data/etf/{ticker}/portfolio`
 * and `/api/funds/{bw_fund_id}/portfolio`). `id` accepts a `bw_bench_id`
 * (`BW-BENCH-SPY`) or an alias (`SPY`, `70/30`). `weight_basis` (reported in the
 * response) is v1 = `latest_holdings_constant` — the factor profile of the
 * benchmark's current composition over ERM3 monthly's full history (the right
 * view for a benchmark's risk profile). `variance_shares` carries the
 * diversification-credited full-window market/sector/subsector/residual shares.
 * Soft gateway auth (public read). 404 on unknown id/alias or no decomposition.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "benchmark id is required" }, { status: 400 });
  const bwBenchId = resolveBenchmarkId(id);
  if (!bwBenchId) return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });

  const url = new URL(request.url);
  const startDate = url.searchParams.get("start_date")?.trim() || undefined;
  const endDate = url.searchParams.get("end_date")?.trim() || undefined;
  for (const d of [startDate, endDate]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ error: "start_date / end_date must be YYYY-MM-DD" }, { status: 400 });
    }
  }

  const series = await readSurfacePortfolioSeries(bwBenchId, { startDate, endDate });
  if (!series) return NextResponse.json({ error: "Benchmark not found or no portfolio decomposition available" }, { status: 404 });

  const headers = new Headers();
  if (series.n_rows > 0) headers.set("X-Data-As-Of", series.rows[series.n_rows - 1]!.teo);
  return NextResponse.json({ benchmark_context_id: bwBenchId, ...series }, { headers });
}
