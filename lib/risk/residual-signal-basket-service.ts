/**
 * Residual mean-reversion basket aggregator (R.5).
 *
 * User-defined ticker list → aggregate Phase D residual-reversion stats.
 * Builds on the existing per-ticker / latest snapshot readers — pulls one
 * universe snapshot, filters to the requested tickers, optionally applies
 * a signal-quality gate, then aggregates with equal or caller-supplied
 * weights.
 *
 * Trust contract: tickers not present in ds_erm3_residual_signal are
 * silently skipped (the upstream mask is the source of truth for "good"
 * rows). The response carries `coverage` so the caller sees what landed
 * in the basket vs what was asked for — no per-name drop reasoning beyond
 * the simple in_zarr boolean.
 */

import {
  readResidualSignalLatest,
  type ResidualSignalSnapshotRow,
} from "@/lib/dal/zarr-reader";
import {
  RESIDUAL_SIGNAL_CAPACITY_NOTE,
  RESIDUAL_SIGNAL_METHODOLOGY_LINK,
} from "./residual-signal-service";

export interface BasketMemberRow extends ResidualSignalSnapshotRow {
  weight: number;
  in_zarr: boolean;
  passed_quality_gate: boolean;
}

export interface BasketAggregate {
  /** Weighted mean of residual_z_5d across included members (null if no member contributed). */
  residual_z_5d: number | null;
  /** Weighted mean of signal_strength (|z|). */
  signal_strength: number | null;
  /** Weighted mean of industry_percentile (within-industry rank, 0–1). */
  industry_percentile: number | null;
  /** Weighted mean of residual_autocorr_5d. */
  residual_autocorr_5d: number | null;
  /** Weighted mean of l3_subsector_er. */
  l3_subsector_er: number | null;
  /** Member-count histogram by decile (1 = most oversold, 10 = most overbought, null = missing). */
  decile_distribution: Record<string, number>;
  /** Member-count histogram by signal_quality_quintile (1 = lowest L3-ER, 5 = highest). */
  quality_quintile_distribution: Record<string, number>;
}

export interface BasketCoverage {
  /** How many tickers the caller asked about. */
  requested: number;
  /** How many had rows in ds_erm3_residual_signal at the latest teo. */
  in_zarr: number;
  /** How many of the in-zarr members passed the optional quality gate. */
  contributed: number;
  /** Sum of input weights for the members that contributed. */
  weight_covered: number;
  /** Tickers asked for but absent from ds_erm3_residual_signal at this teo. */
  missing_tickers: string[];
}

export interface ResidualSignalBasketResult {
  as_of_date: string;
  aggregate: BasketAggregate;
  coverage: BasketCoverage;
  members: BasketMemberRow[];
  capacity_note: string;
  methodology_link: string;
}

export interface BasketOptions {
  /** Optional per-ticker weights aligned to `tickers`. Equal-weight when omitted. */
  weights?: number[];
  /**
   * Minimum signal_quality_quintile to include in the aggregate (1–5).
   * Members below this still appear in `members` with `passed_quality_gate=false`
   * but don't contribute to `aggregate` or `coverage.contributed`. Phase B finding:
   * gross Sharpe lifts from ~0.79 (universe) to ~1.28 in quintile 5.
   */
  signal_quality_min_quintile?: number;
}

/** Weighted mean of (value, weight) pairs; null when no member contributed. */
function weightedMean(
  values: Array<{ v: number | null; w: number }>,
): number | null {
  let num = 0;
  let den = 0;
  for (const { v, w } of values) {
    if (v == null || !Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function emptyDistribution(buckets: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of buckets) out[String(b)] = 0;
  out["null"] = 0;
  return out;
}

/**
 * Aggregate the Phase D residual-reversion signal over a user-supplied basket.
 * Returns null when the underlying zarr is unavailable; returns a result with
 * zero contributors when no requested ticker has a row at the latest teo.
 */
export async function getResidualSignalBasket(
  tickers: string[],
  opts: BasketOptions = {},
): Promise<ResidualSignalBasketResult | null> {
  const snap = await readResidualSignalLatest();
  if (!snap.teo) return null;

  // Normalize + de-duplicate caller input while preserving first-seen order so
  // the optional `weights` array stays aligned.
  const seen = new Set<string>();
  const orderedTickers: string[] = [];
  const orderedWeights: number[] = [];
  const weightInput = opts.weights;
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i]!.trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    orderedTickers.push(t);
    if (weightInput && i < weightInput.length) {
      const w = Number(weightInput[i]);
      orderedWeights.push(Number.isFinite(w) && w > 0 ? w : 0);
    } else {
      orderedWeights.push(1);
    }
  }

  // Index the snapshot once for O(1) per-ticker lookup.
  const byTicker = new Map<string, ResidualSignalSnapshotRow>();
  for (const r of snap.rows) byTicker.set(r.ticker.trim().toUpperCase(), r);

  const minQuintile =
    opts.signal_quality_min_quintile != null
      ? Math.min(5, Math.max(1, Math.floor(opts.signal_quality_min_quintile)))
      : null;

  const members: BasketMemberRow[] = [];
  const missing: string[] = [];
  const decileDist = emptyDistribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const qualityDist = emptyDistribution([1, 2, 3, 4, 5]);

  const contributors: Array<{ row: ResidualSignalSnapshotRow; weight: number }> = [];

  for (let i = 0; i < orderedTickers.length; i++) {
    const ticker = orderedTickers[i]!;
    const weight = orderedWeights[i]!;
    const row = byTicker.get(ticker);
    if (!row) {
      missing.push(ticker);
      members.push({
        ticker,
        residual_z_5d: null,
        signal_strength: null,
        decile_rank: null,
        industry_percentile: null,
        residual_autocorr_5d: null,
        l3_subsector_er: null,
        signal_quality_quintile: null,
        weight,
        in_zarr: false,
        passed_quality_gate: false,
      });
      continue;
    }

    const passesGate =
      minQuintile == null ||
      (row.signal_quality_quintile != null &&
        Math.round(row.signal_quality_quintile) >= minQuintile);

    members.push({
      ...row,
      weight,
      in_zarr: true,
      passed_quality_gate: passesGate,
    });

    // Distribution histograms include every in-zarr member, gate or no gate —
    // they describe what the basket contains, not what made the aggregate.
    const decileKey =
      row.decile_rank == null ? "null" : String(Math.round(row.decile_rank));
    decileDist[decileKey] = (decileDist[decileKey] ?? 0) + 1;
    const qKey =
      row.signal_quality_quintile == null
        ? "null"
        : String(Math.round(row.signal_quality_quintile));
    qualityDist[qKey] = (qualityDist[qKey] ?? 0) + 1;

    if (passesGate && weight > 0) {
      contributors.push({ row, weight });
    }
  }

  const aggregate: BasketAggregate = {
    residual_z_5d: weightedMean(
      contributors.map((c) => ({ v: c.row.residual_z_5d, w: c.weight })),
    ),
    signal_strength: weightedMean(
      contributors.map((c) => ({ v: c.row.signal_strength, w: c.weight })),
    ),
    industry_percentile: weightedMean(
      contributors.map((c) => ({ v: c.row.industry_percentile, w: c.weight })),
    ),
    residual_autocorr_5d: weightedMean(
      contributors.map((c) => ({ v: c.row.residual_autocorr_5d, w: c.weight })),
    ),
    l3_subsector_er: weightedMean(
      contributors.map((c) => ({ v: c.row.l3_subsector_er, w: c.weight })),
    ),
    decile_distribution: decileDist,
    quality_quintile_distribution: qualityDist,
  };

  const coverage: BasketCoverage = {
    requested: orderedTickers.length,
    in_zarr: orderedTickers.length - missing.length,
    contributed: contributors.length,
    weight_covered: contributors.reduce((s, c) => s + c.weight, 0),
    missing_tickers: missing,
  };

  return {
    as_of_date: snap.teo,
    aggregate,
    coverage,
    members,
    capacity_note: RESIDUAL_SIGNAL_CAPACITY_NOTE,
    methodology_link: RESIDUAL_SIGNAL_METHODOLOGY_LINK,
  };
}
