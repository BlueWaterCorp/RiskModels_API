import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  computeBenchActiveFit,
  computeBenchActiveFitAll,
  computeBenchmarkFit,
  resolveBenchmarkId,
} from "@/lib/dal/funds-zarr-reader";
import { isBenchLive } from "@/lib/benchmark-registry";
import { isValidStyleSlug } from "@/lib/funds/style-slug";

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
 *   benchmark = a bw_bench_id (BW-BENCH-…) or an alias (SPY, 70/30, …) — the
 *               static benches, served on the free gateway plane;
 *               or a custom bench (billed, capability `bench-active-custom`):
 *                 ff_own       — free-float-cap weight of the subject's own
 *                                holdings (conviction vs what cap alone implies;
 *                                cap_coverage + cap_var in benchmark_provenance)
 *                 cell_<slug>  — 9-box style-cell MV weight surface
 *                                (e.g. cell_large-growth)
 *                 all          — fan-out: SPY + ff_own + the subject's declared
 *                                style cell (when resolvable) in one call.
 *
 * 400 on a bad cell slug, 404 when a benchmark alias doesn't resolve or a
 * surface is missing. Readiness gate (lib/benchmark-registry.ts): benches
 * marked `development` (hollow trailing teos, shallow history, unverifiable
 * stores) are blocked with 409 before auth/billing — never billed — and are
 * listed in `omitted[]` with reason `under_development` on the `all` fan-out.
 * X-Data-As-Of / X-Benchmark-As-Of headers on single-fit
 * responses (X-Data-As-Of only on `all`).
 */

interface ParsedFitParams {
  subject: string;
  benchmark: string;
  asOf?: string;
  topN: number;
}

function parseFitParams(request: NextRequest): ParsedFitParams | NextResponse {
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
  return { subject, benchmark, asOf, topN };
}

/** Billed handler for the custom benches (ff_own / cell_<slug> / all). */
const customBenchGET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const parsed = parseFitParams(request);
    if (parsed instanceof NextResponse) return parsed;
    const { subject, benchmark, asOf, topN } = parsed;

    if (benchmark.trim().toLowerCase() === "all") {
      const all = await computeBenchActiveFitAll(subject, { asOf, topN });
      if (!all) {
        return NextResponse.json(
          { error: "No surface available for the subject (SPY + ff_own both failed)" },
          { status: 404 },
        );
      }
      const headers = new Headers();
      headers.set("X-Data-As-Of", all.subject_teo);
      return NextResponse.json(all, { headers });
    }

    const fit = await computeBenchActiveFit(subject, benchmark, { asOf, topN });
    if (!fit) {
      return NextResponse.json(
        { error: "No surface available for the subject, or no cap/cell data for the custom benchmark" },
        { status: 404 },
      );
    }
    const headers = new Headers();
    headers.set("X-Data-As-Of", fit.subject_teo);
    headers.set("X-Benchmark-As-Of", fit.benchmark_teo);
    return NextResponse.json(fit, { headers });
  },
  { capabilityId: "bench-active-custom" },
);

/** 409 body for a bench blocked by the readiness gate (never billed). */
function benchUnderDevelopment(id: string): NextResponse {
  return NextResponse.json(
    { error: `benchmark '${id}' is under development`, status: "development" },
    { status: 409 },
  );
}

export async function GET(request: NextRequest) {
  const benchmarkRaw =
    new URL(request.url).searchParams.get("benchmark")?.trim() ?? "";
  const benchLow = benchmarkRaw.toLowerCase();

  // Bad cell slugs are a client error on either plane — fail before auth.
  if (benchLow.startsWith("cell_") && !isValidStyleSlug(benchLow.slice("cell_".length))) {
    return NextResponse.json(
      { error: `Invalid style-cell benchmark: ${benchmarkRaw} (expected cell_<9-box slug>, e.g. cell_large-growth)` },
      { status: 400 },
    );
  }

  // Custom benches (ff_own / cell_<slug> / all) → billed capability path.
  // Readiness gate runs BEFORE withBilling — a blocked bench is never billed.
  if (benchLow === "ff_own" || benchLow.startsWith("cell_")) {
    if (!isBenchLive(benchLow)) return benchUnderDevelopment(benchLow);
    return customBenchGET(request);
  }
  if (benchLow === "all") {
    return customBenchGET(request);
  }

  // Static benches: soft gateway auth (public read), unchanged behavior.
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const parsed = parseFitParams(request);
  if (parsed instanceof NextResponse) return parsed;
  const { subject, benchmark, asOf, topN } = parsed;

  // Readiness gate on the resolved static id (fail-closed: ids absent from
  // the registry are development). Unknown aliases still 404 below.
  const bwBenchId = resolveBenchmarkId(benchmark);
  if (bwBenchId && !isBenchLive(bwBenchId)) {
    return benchUnderDevelopment(bwBenchId);
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
