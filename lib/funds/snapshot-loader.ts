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
  readFundBookShape,
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
import {
  classifyFundBook,
  LONG_SHORT_UNAVAILABLE_CODE,
  LONG_SHORT_UNAVAILABLE_MESSAGE,
} from "@/lib/funds/long-short-guard";

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
  | {
      ok: false;
      status: number;
      error: string;
      /** Machine-readable reason, set for refusals such as the long-short guard. */
      code?: string;
      detail?: Record<string, unknown>;
    };

/**
 * Refuse the F1 composition for long-short books (see
 * `lib/funds/long-short-guard.ts`). 422, so the billing middleware does not
 * charge and the PDF route refuses before its cache lookup.
 */
export async function checkLongShortGuard(
  bwFundId: string,
): Promise<Extract<LoadFundSnapshotResult, { ok: false }> | null> {
  const shape = await readFundBookShape(bwFundId);
  if (!shape) return null;
  const verdict = classifyFundBook(shape);
  if (!verdict.refuse) return null;
  return {
    ok: false,
    status: 422,
    error: LONG_SHORT_UNAVAILABLE_MESSAGE,
    code: LONG_SHORT_UNAVAILABLE_CODE,
    detail: {
      rule: verdict.rule,
      reason: verdict.reason,
      book_as_of: shape.teo,
      long_to_net_assets: verdict.long_nav,
      short_to_net_assets: verdict.short_nav,
      net_to_net_assets: verdict.net_nav,
      n_long: shape.n_long,
      n_short: shape.n_short,
    },
  };
}

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
  const refused = await checkLongShortGuard(bwFundId);
  if (refused) return refused;
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
