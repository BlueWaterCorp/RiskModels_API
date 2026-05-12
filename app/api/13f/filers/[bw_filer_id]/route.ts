import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { resolveFilerById } from "@/lib/dal/filers-engine";
import { formatFilerMetrics } from "@/lib/13f/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/13f/filers/{bw_filer_id}
 *
 * Latest knowledge-mode metrics for a single 13F filer. Reads from
 * public.filers + public.filer_portfolios_latest. Pure Supabase; per-filer
 * holdings + portfolio history live on GCS Zarr and surface via
 * /holdings, /portfolio, /snapshot.
 *
 * Bitemporal lineage on response headers: X-Data-As-Of (= report_date),
 * X-Data-Filing-Date (= filing_date), X-Risk-Model-Version. Returns the
 * latest knowledge-mode row only; ?as_of= is deferred.
 *
 * Returns 200 with metrics block even when filer_portfolios_latest has no
 * row yet — mirrors the schema-ready-but-empty state of the table during
 * Phase 1 ramp-up. NULL fields are surfaced as `null` rather than synthesized.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFilerId = segments[segments.length - 1];
    if (!bwFilerId) {
      return NextResponse.json(
        { error: "bw_filer_id is required" },
        { status: 400 },
      );
    }

    const result = await resolveFilerById(bwFilerId);
    if (!result) {
      return NextResponse.json({ error: "Filer not found" }, { status: 404 });
    }

    const body = formatFilerMetrics(result.filer, result.latest);
    const headers = new Headers();
    if (result.latest?.report_date) {
      headers.set("X-Data-As-Of", result.latest.report_date);
    } else if (result.filer.latest_report_date) {
      headers.set("X-Data-As-Of", result.filer.latest_report_date);
    }
    if (result.latest?.filing_date) {
      headers.set("X-Data-Filing-Date", result.latest.filing_date);
    } else if (result.filer.latest_filing_date) {
      headers.set("X-Data-Filing-Date", result.filer.latest_filing_date);
    }
    if (result.latest?.model_version) {
      headers.set("X-Risk-Model-Version", result.latest.model_version);
    }

    return NextResponse.json(body, { headers });
  },
  { capabilityId: "filer-metrics" },
);
