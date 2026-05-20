/**
 * Residual mean-reversion signal service (Phase D).
 *
 * Thin shaping layer over the zarr-reader. The signal is the L3 orthogonal
 * residual's 5-day mean-reversion factor — see
 * BWMACRO/research/phase_b_minimum_experiment_results.md.
 *
 * Product framing: a combo-input factor building block for multi-signal alpha
 * stacks, NOT a standalone tradeable strategy. Every response carries an
 * explicit gross-Sharpe + capacity disclosure. No buy/sell surface, no
 * tradeable-alpha figure.
 */

import {
  readResidualSignalSeries,
  readResidualSignalLatest,
  type ResidualSignalPoint,
  type ResidualSignalSnapshotRow,
} from "@/lib/dal/zarr-reader";

/**
 * Honest capacity disclosure attached to every residual-signal response.
 * Phase B: gross Sharpe ~0.79 (decile L-S, H=5d) rising to ~1.28 in the
 * top subsector-ER quintile; net of Kissell-Glantz market impact, standalone
 * deployment caps near ~$1M book. Designed to be combined with other signals.
 */
export const RESIDUAL_SIGNAL_CAPACITY_NOTE =
  "Informational factor for multi-signal alpha stacks; not investment advice. " +
  "Gross Sharpe ~0.79 (decile long-short, 5-day horizon), ~1.28 within the " +
  "high-subsector-ER quintile (signal_quality_quintile = 5). Net of " +
  "market-impact costs, standalone deployment caps near ~$1M book size — " +
  "intended as a combo input, not a standalone strategy.";

export const RESIDUAL_SIGNAL_METHODOLOGY_LINK =
  "https://riskmodels.app/docs/methodology#residual-mean-reversion-signal";

export interface ResidualSignalReading {
  residual_z_5d: number | null;
  signal_strength: number | null;
  decile_rank: number | null;
  industry_percentile: number | null;
  residual_autocorr_5d: number | null;
  l3_subsector_er: number | null;
  signal_quality_quintile: number | null;
}

export interface ResidualSignalTickerResult {
  ticker: string;
  as_of_date: string;
  signal: ResidualSignalReading;
  history: ResidualSignalPoint[];
  capacity_note: string;
  methodology_link: string;
}

export interface ResidualSignalUniverseResult {
  as_of_date: string;
  count: number;
  total: number;
  rows: ResidualSignalSnapshotRow[];
  capacity_note: string;
}

export interface ResidualSignalDecileResult {
  as_of_date: string;
  decile: number;
  count: number;
  rows: ResidualSignalSnapshotRow[];
  capacity_note: string;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Per-ticker snapshot + history. `days` is a calendar-day lookback for the
 * history window (default 90). Returns null if the ticker isn't in the
 * universe or the store is unavailable.
 */
export async function getResidualSignalForTicker(
  ticker: string,
  days = 90,
): Promise<ResidualSignalTickerResult | null> {
  const startDate = isoDaysAgo(days);
  const series = await readResidualSignalSeries(ticker, startDate);
  if (!series || series.points.length === 0) return null;

  const latest = series.points[series.points.length - 1]!;
  return {
    ticker: series.ticker,
    as_of_date: latest.date,
    signal: {
      residual_z_5d: latest.residual_z_5d,
      signal_strength: latest.signal_strength,
      decile_rank: latest.decile_rank,
      industry_percentile: latest.industry_percentile,
      residual_autocorr_5d: latest.residual_autocorr_5d,
      l3_subsector_er: latest.l3_subsector_er,
      signal_quality_quintile: latest.signal_quality_quintile,
    },
    history: series.points,
    capacity_note: RESIDUAL_SIGNAL_CAPACITY_NOTE,
    methodology_link: RESIDUAL_SIGNAL_METHODOLOGY_LINK,
  };
}

/**
 * Full active-universe cross-section at the latest teo, sorted by
 * residual_z_5d ascending (most "oversold" first), paginated.
 */
export async function getResidualSignalLatest(
  opts: { limit?: number; offset?: number } = {},
): Promise<ResidualSignalUniverseResult | null> {
  const snap = await readResidualSignalLatest();
  if (!snap.teo) return null;

  const sorted = [...snap.rows].sort(
    (a, b) => (a.residual_z_5d ?? 0) - (b.residual_z_5d ?? 0),
  );
  const limit = Math.min(2000, Math.max(1, Math.floor(opts.limit ?? 500)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const page = sorted.slice(offset, offset + limit);

  return {
    as_of_date: snap.teo,
    count: page.length,
    total: sorted.length,
    rows: page,
    capacity_note: RESIDUAL_SIGNAL_CAPACITY_NOTE,
  };
}

/**
 * Current members of decile `n` (1 = most negative z / most oversold,
 * 10 = most positive z / most overbought), sorted by residual_z_5d.
 */
export async function getResidualSignalDecile(
  n: number,
): Promise<ResidualSignalDecileResult | null> {
  const snap = await readResidualSignalLatest();
  if (!snap.teo) return null;

  const decile = Math.min(10, Math.max(1, Math.floor(n)));
  const rows = snap.rows
    .filter((r) => r.decile_rank != null && Math.round(r.decile_rank) === decile)
    .sort((a, b) => (a.residual_z_5d ?? 0) - (b.residual_z_5d ?? 0));

  return {
    as_of_date: snap.teo,
    decile,
    count: rows.length,
    rows,
    capacity_note: RESIDUAL_SIGNAL_CAPACITY_NOTE,
  };
}
