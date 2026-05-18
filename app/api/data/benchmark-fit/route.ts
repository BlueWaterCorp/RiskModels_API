import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { computeBenchmarkFit } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/benchmark-fit?subject=<id>&benchmark=<id|alias>&as_of=YYYY-MM-DD&top=10
 *
 * `BenchmarkFit` — the comparison facet (CANONICAL_INTELLIGENCE_OBJECTS.md §9):
 * fit a subject portfolio's weight vector against a benchmark surface at a
 * common teo (the subject's latest teo ≤ `as_of`; the benchmark then at its
 * latest teo ≤ the subject's teo — never peeking ahead). Returns active share,
 * an active-weight RMS (a coarse tracking-error proxy — factor-based TE is a
 * follow-on), overlap, and the top over/underweights.
 *
 *   subject   = a BW-* portfolio id (BW-FUND-…, BW-FILER-…, BW-ETF-…, BW-BENCH-…)
 *               or an ETF ticker (→ BW-ETF-{TICKER}).
 *   benchmark = a bw_bench_id (BW-BENCH-…) or an alias (SPY, 70/30, …).
 *
 * Soft gateway auth (public read). 404 when the benchmark alias doesn't resolve
 * or either surface is missing.
 */
export async function GET(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const subject = url.searchParams.get("subject")?.trim();
  const benchmark = url.searchParams.get("benchmark")?.trim();
  const asOf = url.searchParams.get("as_of")?.trim() || undefined;
  const topRaw = url.searchParams.get("top");
  let topN = 10;
  if (topRaw != null) {
    const p = Number.parseInt(topRaw, 10);
    if (Number.isFinite(p)) topN = Math.min(Math.max(p, 1), 100);
  }
  if (!subject || !benchmark) {
    return NextResponse.json(
      { error: "both `subject` and `benchmark` query params are required" },
      { status: 400 },
    );
  }
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: "`as_of` must be YYYY-MM-DD" }, { status: 400 });
  }

  const fit = await computeBenchmarkFit(subject, benchmark, { asOf, topN });
  if (!fit) {
    return NextResponse.json(
      { error: "Unknown benchmark, or no surface available for the subject/benchmark" },
      { status: 404 },
    );
  }

  const headers = new Headers();
  headers.set("X-Data-As-Of", fit.subject_teo);
  headers.set("X-Benchmark-As-Of", fit.benchmark_teo);
  return NextResponse.json(fit, { headers });
}
