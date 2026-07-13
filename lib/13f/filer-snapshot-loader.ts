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
  type FilerRow,
} from "@/lib/dal/filers-engine";
import {
  isSyntheticEntityId,
  readFilerHoldingsTopN,
  readFilerPortfolioSeries,
  readFilerReturnsDecomposition,
  readFilerHedgeLatest,
  readSyntheticEntityMeta,
} from "@/lib/dal/funds-zarr-reader";
import {
  composeFilerSnapshot,
  type FilerSnapshot,
} from "@/lib/13f/filer-snapshot-composer";
import { enrichFilerHoldingsWithL3 } from "@/lib/13f/enrich-filer-holdings";

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
  // Synthetic composite entities (BW-SYNTH-*) are served by the same route.
  // They have no registry row — the zarr attrs are self-describing.
  if (isSyntheticEntityId(bwFilerId)) {
    return loadSyntheticCompositeSnapshot(bwFilerId);
  }
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
  const startDate = lookbackStartDate(referenceDate);

  const [holdingsRaw, portfolioHistory, cohortRanks, returnsDec, hedgeSleeve] =
    await Promise.all([
      readFilerHoldingsTopN(bwFilerId, HOLDINGS_TOP_N),
      readFilerPortfolioSeries(bwFilerId, {
        startDate,
        endDate: referenceDate ?? undefined,
      }),
      fetchFilerRanks(bwFilerId),
      readFilerReturnsDecomposition(bwFilerId, {
        startDate,
        endDate: referenceDate ?? undefined,
      }),
      readFilerHedgeLatest(bwFilerId),
    ]);

  const holdings = await enrichFilerHoldingsWithL3(holdingsRaw);

  const snapshot = composeFilerSnapshot({
    filer,
    latest,
    holdings,
    portfolioHistory,
    cohortRanks,
    returnsDecomposition: returnsDec,
    hedgeSleeve,
  });

  return {
    ok: true,
    snapshot,
    reportDate: latest?.report_date ?? filer.latest_report_date ?? null,
    filingDate: latest?.filing_date ?? filer.latest_filing_date ?? null,
    modelVersion: latest?.model_version ?? null,
  };
}

function lookbackStartDate(referenceDate: string | null): string | undefined {
  if (!referenceDate) return undefined;
  const startWindow = new Date(`${referenceDate}T12:00:00Z`);
  startWindow.setUTCMonth(startWindow.getUTCMonth() - FILER_LOOKBACK_MONTHS - 1);
  return startWindow.toISOString().slice(0, 10);
}

/**
 * Snapshot for a synthetic composite entity. Same composed shape; the
 * entity resolves from its zarr (attrs + coverage vars) instead of the
 * registry, so registry-only fields (cik, filer_type, aum_tier, cohort
 * ranks) are null/empty. Additive fields: `entity_kind:
 * "synthetic_composite"`, `evidence_class: "reconstructed"`, `recipe`, and
 * composition coverage merged into `coverage`.
 */
async function loadSyntheticCompositeSnapshot(
  bwSynthId: string,
): Promise<LoadFilerSnapshotResult> {
  const meta = await readSyntheticEntityMeta(bwSynthId);
  if (!meta) {
    return { ok: false, status: 404, error: "Entity not found" };
  }

  const referenceDate = meta.teo;
  const startDate = lookbackStartDate(referenceDate);

  const [holdingsRaw, portfolioHistory, returnsDec, hedgeSleeve] =
    await Promise.all([
      readFilerHoldingsTopN(bwSynthId, HOLDINGS_TOP_N),
      readFilerPortfolioSeries(bwSynthId, {
        startDate,
        endDate: referenceDate,
      }),
      readFilerReturnsDecomposition(bwSynthId, {
        startDate,
        endDate: referenceDate,
      }),
      readFilerHedgeLatest(bwSynthId),
    ]);

  const holdings = await enrichFilerHoldingsWithL3(holdingsRaw);

  const filer: FilerRow = {
    bw_filer_id: bwSynthId,
    cik: null,
    lei: null,
    name: meta.name,
    filer_type: null,
    filer_subtype: null,
    country: null,
    status: null,
    style_label: null,
    factset_entity_id: null,
    latest_report_date: meta.teo,
    latest_filing_date: null,
    latest_extracted_at: null,
    latest_aum_usd: null,
    aum_tier: null,
    latest_n_holdings: null,
    last_in_eligible_universe_at: null,
    n_funds_managed: null,
    metadata: null,
  };

  const snapshot = composeFilerSnapshot({
    filer,
    latest: null,
    holdings,
    portfolioHistory,
    cohortRanks: [],
    returnsDecomposition: returnsDec,
    hedgeSleeve,
    synthetic: meta,
  });

  return {
    ok: true,
    snapshot,
    reportDate: meta.teo,
    filingDate: null,
    modelVersion: null,
  };
}
