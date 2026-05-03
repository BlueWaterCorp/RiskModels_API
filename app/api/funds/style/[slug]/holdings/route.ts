import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { readStyleCohortHoldingsTopN } from "@/lib/dal/funds-zarr-reader";
import { styleSlugToName, styleSlugToPathComponent } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

const DEFAULT_TOP_N = 25;
const MAX_TOP_N = 100;

/**
 * GET /api/funds/style/{slug}/holdings?weighting=mv&limit=25
 *
 * Top-N cohort holdings at the latest teo. Reads `weight (teo, symbol, weighting)`
 * and contribution_* / n_funds_holding from Slice 5b's per-cell
 * `equity_style_9box/{Cell_Name}/ds_symbols.zarr`. Sorts by `weight` desc.
 *
 * `?weighting` defaults to `mv` (market-cap-weighted, Morningstar-comparable).
 * Switch to `ew` to see equal-weight cohort exposures — radically different
 * top-N lists for non-uniform cells.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const slug = segments[segments.length - 2];
    const cellName = styleSlugToName(slug ?? "");
    const pathComponent = styleSlugToPathComponent(slug ?? "");
    if (!cellName || !pathComponent) {
      return NextResponse.json(
        { error: `Invalid style slug: ${slug}` },
        { status: 400 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const weighting = (sp.get("weighting") ?? "mv") as "ew" | "mv";
    if (weighting !== "ew" && weighting !== "mv") {
      return NextResponse.json(
        { error: "weighting must be one of: ew, mv" },
        { status: 400 },
      );
    }

    const limitParam = sp.get("limit");
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

    const snapshot = await readStyleCohortHoldingsTopN(pathComponent, {
      weighting,
      n: limit,
    });
    if (!snapshot) {
      return NextResponse.json(
        {
          error: "No cohort holdings panel available for this cell",
          equity_style_9box: cellName,
          slug,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": snapshot.teo });

    return NextResponse.json(
      {
        equity_style_9box: cellName,
        slug,
        ...snapshot,
      },
      { headers },
    );
  },
  { capabilityId: "style-cohort-holdings" },
);
