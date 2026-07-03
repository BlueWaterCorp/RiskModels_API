/**
 * Fund snapshot loader — one composed `FundSnapshot` from the canonical
 * primitives. Shared by the JSON route (`/api/funds/snapshot/{id}`) and
 * the PDF route (`/api/funds/snapshot.pdf/{id}`) so the composition is
 * authored in exactly one place.
 */

import {
  fetchFundCohortRanks,
  fetchStyleCohortLatest,
  resolveFundById,
} from "@/lib/dal/funds-engine";
import {
  readFundHedgeLatest,
  readFundHoldingsTopN,
  readFundNavSeries,
  readFundPortfolioSeries,
  readFundPortfolioDailySeries,
} from "@/lib/dal/funds-zarr-reader";
import {
  composeFundSnapshot,
  type FundSnapshot,
} from "@/lib/funds/snapshot-composer";
import { enrichFundHoldingsWithL3 } from "@/lib/funds/enrich-fund-holdings";

const HOLDINGS_TOP_N = 25;
const FUND_LOOKBACK_MONTHS = 12;

export type LoadFundSnapshotResult =
  | {
      ok: true;
      snapshot: FundSnapshot;
      reportDate: string;
      filingDate: string;
      modelVersion: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Load + compose a full `FundSnapshot` for the given `bw_fund_id`. Pure
 * data — no Response wrapping. Caller decides whether to serialize JSON,
 * render to PDF, etc.
 */
export async function loadFundSnapshot(
  bwFundId: string,
): Promise<LoadFundSnapshotResult> {
  const resolved = await resolveFundById(bwFundId);
  if (!resolved) {
    return { ok: false, status: 404, error: "Fund not found" };
  }
  if (!resolved.latest) {
    return {
      ok: false,
      status: 404,
      error: "No funds_latest row for this fund",
    };
  }
  const { fund, latest } = resolved;

  const reportDate = new Date(`${latest.report_date}T12:00:00Z`);
  const startWindow = new Date(reportDate);
  startWindow.setUTCMonth(
    startWindow.getUTCMonth() - FUND_LOOKBACK_MONTHS - 1,
  );
  const startDate = startWindow.toISOString().slice(0, 10);

  const cohortMetricsP = fund.equity_style_9box
    ? fetchStyleCohortLatest(fund.equity_style_9box)
    : Promise.resolve([]);

  const [
    holdings,
    hedge,
    portfolioHistory,
    portfolioDaily,
    navHistory,
    cohortRanks,
    cohortMetrics,
  ] = await Promise.all([
    readFundHoldingsTopN(bwFundId, HOLDINGS_TOP_N).then(enrichFundHoldingsWithL3),
    readFundHedgeLatest(bwFundId),
    readFundPortfolioSeries(bwFundId, {
      startDate,
      endDate: latest.report_date,
    }),
    readFundPortfolioDailySeries(bwFundId, {
      startDate,
      endDate: latest.report_date,
    }),
    readFundNavSeries(bwFundId, {
      startDate,
      endDate: latest.report_date,
    }),
    fetchFundCohortRanks(bwFundId),
    cohortMetricsP,
  ]);

  const snapshot = composeFundSnapshot({
    fund,
    latest,
    holdings,
    hedge,
    portfolioHistory,
    portfolioDaily,
    navHistory,
    cohortRanks,
    cohortMetrics,
  });

  return {
    ok: true,
    snapshot,
    reportDate: latest.report_date,
    filingDate: latest.filing_date,
    modelVersion: latest.model_version ?? null,
  };
}
