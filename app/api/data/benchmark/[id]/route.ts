import { NextResponse, type NextRequest } from "next/server";
import { readBenchmarkSurface } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/benchmark/:id?top=25
 *
 * A benchmark's canonical PortfolioSurface snapshot — the `BenchmarkContext`
 * (definition: methodology, rebalance schedule, observation semantics,
 * benchmark_kind, proxy/components) plus the latest constituent weight vector
 * (top-N). `id` accepts a `bw_bench_id` (e.g. `BW-BENCH-SPY`) or an alias
 * (e.g. `SPY`, `70/30`). v1 catalog: SPY (index_proxy ← IVV), EQ70-30 (blend).
 * See docs/architecture/CANONICAL_INTELLIGENCE_OBJECTS.md §9 / MASTER_BACKLOG L.8.
 *
 * `report_date` (the surface's latest teo) and `availability_date` (when that
 * snapshot was observed) are surfaced distinctly + as headers. Soft gateway
 * auth (public read, like the rest of `/api/data/*`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "benchmark id is required" }, { status: 400 });

  const url = new URL(request.url);
  const topRaw = url.searchParams.get("top");
  let top = 25;
  if (topRaw != null) {
    const p = Number.parseInt(topRaw, 10);
    if (Number.isFinite(p)) top = Math.min(Math.max(p, 1), 1000);
  }

  const snap = await readBenchmarkSurface(id, top);
  if (!snap) return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });

  const headers = new Headers();
  headers.set("X-Data-As-Of", snap.report_date);
  if (snap.availability_date) headers.set("X-Data-Availability", snap.availability_date);
  return NextResponse.json(snap, { headers });
}
