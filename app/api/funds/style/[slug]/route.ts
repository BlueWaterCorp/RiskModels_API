import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchStyleCohortLatest } from "@/lib/dal/funds-engine";
import { styleSlugToName } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/style/{slug}
 *
 * Latest cohort metrics for a 9-box style cell. Returns both EW and MV
 * weightings side-by-side under a `weightings` map (Slice 6 emits both).
 * Bitemporal lineage on response headers from `report_date` /
 * `filing_date_max`.
 *
 * The "differentiated wedge" surface — Morningstar reports per-fund metrics
 * but doesn't expose cohort-level aggregates with this attribution depth.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const slug = segments[segments.length - 1];
    const cellName = styleSlugToName(slug ?? "");
    if (!cellName) {
      return NextResponse.json(
        { error: `Invalid style slug: ${slug}` },
        { status: 400 },
      );
    }

    const rows = await fetchStyleCohortLatest(cellName);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "No cohort metrics available for this cell",
          equity_style_9box: cellName,
          slug,
        },
        { status: 404 },
      );
    }

    const byWeighting: Record<string, unknown> = {};
    let reportDate = rows[0]!.report_date;
    let filingDateMax = rows[0]!.filing_date_max;
    let modelVersion = rows[0]!.model_version;
    let lastSyncedAt = rows[0]!.last_synced_at;
    let nFundsInCell = rows[0]!.n_funds_in_cell;

    for (const r of rows) {
      byWeighting[r.weighting] = {
        portfolio_gross_return: r.portfolio_gross_return,
        portfolio_market_return: r.portfolio_market_return,
        portfolio_sector_return: r.portfolio_sector_return,
        portfolio_subsector_return: r.portfolio_subsector_return,
        portfolio_idiosyncratic_return: r.portfolio_idiosyncratic_return,
        identity_residual: r.identity_residual,
        weight_sum: r.weight_sum,
        n_holdings_active: r.n_holdings_active,
        effective_n: r.effective_n,
        top10_weight_sum: r.top10_weight_sum,
      };
      // Use the freshest report_date / filing_date_max across rows.
      if (r.report_date > reportDate) reportDate = r.report_date;
      if (r.filing_date_max && (!filingDateMax || r.filing_date_max > filingDateMax)) {
        filingDateMax = r.filing_date_max;
      }
      if (r.last_synced_at > lastSyncedAt) lastSyncedAt = r.last_synced_at;
      if (r.model_version) modelVersion = r.model_version;
      if (r.n_funds_in_cell != null) nFundsInCell = r.n_funds_in_cell;
    }

    const headers = new Headers({ "X-Data-As-Of": reportDate });
    if (filingDateMax) headers.set("X-Data-Filing-Date", filingDateMax);
    if (modelVersion) headers.set("X-Risk-Model-Version", modelVersion);

    return NextResponse.json(
      {
        equity_style_9box: cellName,
        slug,
        report_date: reportDate,
        filing_date_max: filingDateMax,
        n_funds_in_cell: nFundsInCell,
        weightings: byWeighting,
        _metadata: {
          model_version: modelVersion,
          data_as_of: reportDate,
          data_freshness: lastSyncedAt,
          last_synced_at: lastSyncedAt,
        },
      },
      { headers },
    );
  },
  { capabilityId: "style-cohort-metrics" },
);
