import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler } from "@/lib/dal/filers-engine";
import { readFilerHoldingsTopN } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const DEFAULT_TOP_N = 25;
const MAX_TOP_N = 1000;

/**
 * GET /api/13f/filers/{bw_filer_id}/holdings?limit=25
 *
 * Top-N current holdings at the filer's latest teo. Reads per-filer
 * ds_ph.zarr from GCS. Each holding carries `security_id` (post-D.8.1 =
 * bw_sym_id; pre-migration = a raw 9-char security identifier), `adj_mv`,
 * and `weight` (fraction of total in-portfolio AUM).
 *
 * Default `limit = 25`; caller can request up to 1000.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFilerId = segments[segments.length - 2];
    if (!bwFilerId) {
      return NextResponse.json(
        { error: "bw_filer_id is required" },
        { status: 400 },
      );
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    let limit = DEFAULT_TOP_N;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          { error: "limit must be a positive integer" },
          { status: 400 },
        );
      }
      limit = Math.min(Math.floor(parsed), MAX_TOP_N);
    }

    const filer = await fetchFiler(bwFilerId);
    if (!filer) {
      return NextResponse.json({ error: "Filer not found" }, { status: 404 });
    }

    const snapshot = await readFilerHoldingsTopN(bwFilerId, limit);
    if (!snapshot) {
      return NextResponse.json(
        {
          error: "No holdings panel available for this filer",
          bw_filer_id: bwFilerId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": snapshot.teo });
    if (filer.latest_filing_date) {
      headers.set("X-Data-Filing-Date", filer.latest_filing_date);
    }

    return NextResponse.json(
      {
        bw_filer_id: bwFilerId,
        cik: filer.cik,
        name: filer.name,
        filer_type: filer.filer_type,
        aum_tier: filer.aum_tier,
        ...snapshot,
      },
      { headers },
    );
  },
  { capabilityId: "filer-holdings" },
);
