/**
 * Filer snapshot loader — one composed `FilerSnapshot` from the canonical
 * primitives. Shared by the JSON route (`/api/13f/filers/{id}/snapshot`)
 * and (when Phase 1 PDF lands) the PDF route.
 *
 * Mirrors `lib/funds/snapshot-loader.ts`. Pure data — no Response wrapping.
 */

import {
  fetchFilerRanks,
  resolveFilerById,
} from "@/lib/dal/filers-engine";
import {
  readFilerHoldingsTopN,
  readFilerPortfolioSeries,
} from "@/lib/dal/funds-zarr-reader";
import {
  composeFilerSnapshot,
  type FilerSnapshot,
} from "@/lib/13f/filer-snapshot-composer";

const HOLDINGS_TOP_N = 25;
const FILER_LOOKBACK_MONTHS = 12;

export type LoadFilerSnapshotResult =
  | {
      ok: true;
      snapshot: FilerSnapshot;
      reportDate: string | null;
      filingDate: string | null;
      modelVersion: string | null;
    }
  | { ok: false; status: number; error: string };

export async function loadFilerSnapshot(
  bwFilerId: string,
): Promise<LoadFilerSnapshotResult> {
  const resolved = await resolveFilerById(bwFilerId);
  if (!resolved) {
    return { ok: false, status: 404, error: "Filer not found" };
  }
  const { filer, latest } = resolved;

  // Filers without a filer_portfolios_latest row still get a snapshot —
  // registry-only filers render with metrics = null + portfolio_history = []
  // rather than 404. This matches the schema-ready-but-empty state of the
  // table during Phase 1 ramp-up.
  const referenceDate = latest?.report_date ?? filer.latest_report_date ?? null;
  let startDate: string | undefined = undefined;
  if (referenceDate) {
    const ref = new Date(`${referenceDate}T12:00:00Z`);
    const startWindow = new Date(ref);
    startWindow.setUTCMonth(
      startWindow.getUTCMonth() - FILER_LOOKBACK_MONTHS - 1,
    );
    startDate = startWindow.toISOString().slice(0, 10);
  }

  const [holdings, portfolioHistory, cohortRanks] = await Promise.all([
    readFilerHoldingsTopN(bwFilerId, HOLDINGS_TOP_N),
    readFilerPortfolioSeries(bwFilerId, {
      startDate,
      endDate: referenceDate ?? undefined,
    }),
    fetchFilerRanks(bwFilerId),
  ]);

  const snapshot = composeFilerSnapshot({
    filer,
    latest,
    holdings,
    portfolioHistory,
    cohortRanks,
  });

  return {
    ok: true,
    snapshot,
    reportDate: latest?.report_date ?? filer.latest_report_date ?? null,
    filingDate: latest?.filing_date ?? filer.latest_filing_date ?? null,
    modelVersion: latest?.model_version ?? null,
  };
}
