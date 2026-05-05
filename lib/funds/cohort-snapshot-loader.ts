/**
 * Cohort snapshot loader — one composed `CohortSnapshot` from the canonical
 * primitives. Shared by the JSON route (`/api/funds/style/{slug}/snapshot`)
 * and the PDF route (`/api/funds/style/{slug}/snapshot.pdf`) so the
 * composition is authored in exactly one place.
 */

import {
  fetchStyleCohortLatest,
  fetchStyleRankings,
} from "@/lib/dal/funds-engine";
import {
  readStyleCohortHoldingsTopN,
  readStyleCohortPortfolioSeries,
} from "@/lib/dal/funds-zarr-reader";
import {
  composeCohortSnapshot,
  type CohortSnapshot,
} from "@/lib/funds/snapshot-composer";
import {
  styleSlugToName,
  styleSlugToPathComponent,
} from "@/lib/funds/style-slug";

const HOLDINGS_TOP_N = 25;
const TOP_FUNDS_LIMIT = 10;
const TOP_SYMBOLS_LIMIT = 15;
const COHORT_LOOKBACK_MONTHS = 12;

export type LoadCohortSnapshotResult =
  | {
      ok: true;
      snapshot: CohortSnapshot;
      reportDate: string;
      filingDate: string | null;
      modelVersion: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Load + compose a full `CohortSnapshot` for the given 9-box style slug.
 * Pure data — no Response wrapping. Caller decides whether to serialize
 * JSON, render to PDF, etc.
 */
export async function loadCohortSnapshot(
  slug: string,
): Promise<LoadCohortSnapshotResult> {
  const cellName = styleSlugToName(slug);
  const pathComponent = styleSlugToPathComponent(slug);
  if (!cellName || !pathComponent) {
    return { ok: false, status: 400, error: `Invalid style slug: ${slug}` };
  }

  const cohortMetrics = await fetchStyleCohortLatest(cellName);
  if (cohortMetrics.length === 0) {
    return {
      ok: false,
      status: 404,
      error: "No cohort metrics available for this cell",
    };
  }

  const latestReport = cohortMetrics
    .map((m) => m.report_date)
    .sort()
    .pop()!;
  const reportDateObj = new Date(`${latestReport}T12:00:00Z`);
  const startWindow = new Date(reportDateObj);
  startWindow.setUTCMonth(
    startWindow.getUTCMonth() - COHORT_LOOKBACK_MONTHS - 1,
  );
  const startDate = startWindow.toISOString().slice(0, 10);

  const [topFunds, topSymbols, portfolioHistory, cohortHoldings] =
    await Promise.all([
      fetchStyleRankings(cellName, {
        metric: "portfolio_gross_return",
        cohortType: "fund",
        periodWindow: "12m",
        limit: TOP_FUNDS_LIMIT,
      }),
      fetchStyleRankings(cellName, {
        metric: "weight",
        cohortType: "symbol",
        periodWindow: "1m",
        weighting: "mv",
        limit: TOP_SYMBOLS_LIMIT,
      }),
      readStyleCohortPortfolioSeries(pathComponent, {
        startDate,
        endDate: latestReport,
      }),
      readStyleCohortHoldingsTopN(pathComponent, {
        weighting: "mv",
        n: HOLDINGS_TOP_N,
      }),
    ]);

  const snapshot = composeCohortSnapshot({
    cellName,
    slug,
    cohortMetrics,
    topFunds,
    topSymbols,
    portfolioHistory,
    cohortHoldings,
  });

  if (!snapshot) {
    return {
      ok: false,
      status: 404,
      error: "Cohort snapshot composition produced no rows",
    };
  }

  return {
    ok: true,
    snapshot,
    reportDate: snapshot.report_date,
    filingDate: snapshot.filing_date_max,
    modelVersion: snapshot._metadata.model_version,
  };
}
