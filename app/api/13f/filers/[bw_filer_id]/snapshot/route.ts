import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { loadFilerSnapshot } from "@/lib/13f/filer-snapshot-loader";

export const dynamic = "force-dynamic";

/**
 * GET /api/13f/filers/{bw_filer_id}/snapshot
 *
 * Composed JSON snapshot for a 13F filer. Assembles registry + latest
 * portfolio metrics + top-25 holdings + 12mo portfolio history + cohort
 * ranks (filer_type and aum_tier partitions) + portfolio-derived 9-box
 * style attribution + ERM3 coverage diagnostics + modelability flag.
 *
 * NAV is intentionally absent (filers have no NAV time series). Hedge
 * ratios are Phase 3 (D.8.10) and not present today.
 *
 * All sub-fetches run in parallel inside loadFilerSnapshot.
 *
 * Composite entities (BW-SYNTH-*) are served by the same route; registry-only
 * fields return null and the snapshot adds entity_kind/evidence_class/recipe
 * plus composition coverage.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    // .../filers/{id}/snapshot → second-to-last segment
    const bwFilerId = segments[segments.length - 2];
    if (!bwFilerId) {
      return NextResponse.json(
        { error: "bw_filer_id is required" },
        { status: 400 },
      );
    }

    const result = await loadFilerSnapshot(bwFilerId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, bw_filer_id: bwFilerId },
        { status: result.status },
      );
    }

    const headers = new Headers();
    if (result.reportDate) headers.set("X-Data-As-Of", result.reportDate);
    if (result.filingDate) headers.set("X-Data-Filing-Date", result.filingDate);
    if (result.modelVersion) {
      headers.set("X-Risk-Model-Version", result.modelVersion);
    }

    return NextResponse.json(result.snapshot, { headers });
  },
  { capabilityId: "filer-snapshot-json" },
);
