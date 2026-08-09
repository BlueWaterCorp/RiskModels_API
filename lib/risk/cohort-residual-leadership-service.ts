/**
 * Cohort residual leadership — rank peers by cumulative L3 residual return.
 *
 * WHY THIS EXISTS
 * ---------------
 * The consumer was fanning out `/returns-decomposition` once per cohort member
 * (~51 round-trips) and hitting the 60 req/min ceiling. `fetchBatchHistory`
 * already reads a panel in one call; this endpoint is that call, plus the
 * rank table and the dispersion / coverage figures S10 needs to publish.
 *
 * FOUR CONSTRAINTS (not style — each is a bug the consumer already hit)
 * --------------------------------------------------------------------
 * 1. Window = the cohort ETF's own dates (or the requested window applied to
 *    the latest teo). Never the intersection of members' dates — one short
 *    peer must not truncate everyone else's comparison. Drop short-history
 *    members and report `n_short_history`. Coverage is a TOLERANCE, not an
 *    identity: a member missing up to MAX_MISSING_FRACTION of the window is
 *    still ranked, with its observed count returned per row.
 * 2. Value = SUM of daily `l3_rr`, not a compounded path. Daily gross =
 *    factor + residual, so sums stay additive; compounds carry a cross term.
 * 3. `dispersion.{best,worst,median,sd}` are required. S10 refuses without them.
 * 4. Both `n_ranked` and `n_members` are required. Coverage is part of the claim.
 *
 * Membership query matches `cohort-variance-shares-service` (symbols table
 * sector_etf / subsector_etf). Thin cohorts and short windows are refused
 * (422), unknown cohorts 404 — never a partial 200.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBatchHistory,
  fetchHistory,
  resolveSymbolByTicker,
  type SecurityHistoryRow,
} from "@/lib/dal/risk-engine-v3";
import { MIN_COHORT_MEMBERS } from "@/lib/risk/cohort-variance-shares-service";

export { MIN_COHORT_MEMBERS };

/** Below this many trading days in the ranked window, refuse. */
export const MIN_WINDOW_OBS = 200;

export type CohortLevel = "sector" | "subsector";

export interface ResidualLeadershipRankedRow {
  symbol: string;
  ticker: string;
  rank: number;
  /** Sum of daily l3_rr over the window — a fraction, not percent. */
  value: number;
  /** Days actually observed for this member; <= the window's own count. */
  observed: number;
}

export interface CohortResidualLeadership {
  cohort: string;
  window: string;
  level: CohortLevel;
  teo: string;
  obs: number;
  start_date: string;
  end_date: string;
  n_ranked: number;
  n_members: number;
  n_short_history: number;
  /** Ranked members with at least one missing day, within tolerance. */
  n_partial_coverage: number;
  ranked: ResidualLeadershipRankedRow[];
  dispersion: {
    best: number;
    worst: number;
    median: number;
    sd: number;
  };
  prohibited: string[];
}

export class ThinCohortError extends Error {
  constructor(
    readonly cohort: string,
    readonly nNames: number,
  ) {
    super(
      `Cohort ${cohort} has ${nNames} members with full-window residual history, ` +
        `below the ${MIN_COHORT_MEMBERS} needed to report a ranking.`,
    );
    this.name = "ThinCohortError";
  }
}

export class ShortWindowError extends Error {
  constructor(
    readonly cohort: string,
    readonly obs: number,
  ) {
    super(
      `Cohort ${cohort} resolved window has ${obs} observations, ` +
        `below the ${MIN_WINDOW_OBS} needed for a residual-leadership ranking.`,
    );
    this.name = "ShortWindowError";
  }
}

export class UnknownCohortError extends Error {
  constructor(readonly cohort: string) {
    super(`Unknown cohort '${cohort}'`);
    this.name = "UnknownCohortError";
  }
}

export function parseWindowDays(window: string): number | null {
  const m = /^(\d+)d$/i.exec(window.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Sample standard deviation (N−1). Single-element → 0. */
export function sampleSd(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let ss = 0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

export function medianOf(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sortedAsc[mid]!;
  return (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

async function resolveCohortMembers(
  etf: string,
  level: CohortLevel,
): Promise<Array<{ symbol: string; ticker: string }>> {
  const upper = etf.trim().toUpperCase();
  if (!upper) return [];
  const column = level === "sector" ? "sector_etf" : "subsector_etf";

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("symbols")
    .select("symbol, ticker")
    .eq(column, upper);

  if (error) {
    console.error(`[cohort-residual-leadership] ${column}=${upper} lookup failed:`, error);
    return [];
  }
  return (data ?? [])
    .map((r) => ({
      symbol: (r as { symbol: string }).symbol,
      ticker: String((r as { ticker?: string }).ticker ?? "").toUpperCase(),
    }))
    .filter((r) => Boolean(r.symbol) && Boolean(r.ticker));
}

/**
 * Trailing calendar for the window: last `windowDays` teos from the cohort
 * ETF's own `returns_gross` series. ETF residual history is not required —
 * the ETF defines dates, members contribute `l3_rr` on those dates.
 */
async function resolveWindowDates(
  cohortTicker: string,
  windowDays: number,
): Promise<string[]> {
  const etf = await resolveSymbolByTicker(cohortTicker);
  if (!etf) return [];

  // Over-fetch calendar days so weekends/holidays still leave enough teos.
  const padDays = Math.ceil(windowDays * 1.7) + 30;
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - padDays);
  const startDate = start.toISOString().slice(0, 10);

  const rows = await fetchHistory(etf.symbol, ["returns_gross"], {
    periodicity: "daily",
    startDate,
    orderBy: "asc",
  });

  const dates = Array.from(
    new Set(
      rows
        .filter((r) => r.metric_value != null && Number.isFinite(r.metric_value))
        .map((r) => r.teo),
    ),
  ).sort((a, b) => a.localeCompare(b));

  if (dates.length <= windowDays) return dates;
  return dates.slice(dates.length - windowDays);
}

/**
 * Fraction of the window a member may be missing and still be ranked.
 *
 * This was zero — any missing day dropped the member. The rule it was meant to
 * enforce is "never rank a 250-day return against a 180-day one", and dropping
 * on a single absent print is far stricter than that requires. Measured on XBI:
 * of the members dropped in a large-cap sample, NONE had entered the window
 * mid-way. Every one was a complete record with a short interior gap — IONS was
 * excluded for 2 missing days out of 252.
 *
 * That is not protecting comparability, it is discarding near-complete records,
 * and it biases the surviving cohort toward continuously-traded names: halts
 * and thin prints are not distributed at random across a biotech cohort.
 *
 * 2% keeps the attenuation from missing days below the rounding of the figure
 * it feeds, while admitting the records that were being thrown away.
 */
const MAX_MISSING_FRACTION = 0.02;

function sumResidualOverWindow(
  byTeo: Map<string, number>,
  windowDates: string[],
): { sum: number; observed: number } | null {
  let sum = 0;
  let observed = 0;
  for (const teo of windowDates) {
    const v = byTeo.get(teo);
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    observed += 1;
  }
  const missing = windowDates.length - observed;
  if (missing > Math.floor(windowDates.length * MAX_MISSING_FRACTION)) {
    return null;
  }
  return { sum, observed };
}

export async function getCohortResidualLeadership(params: {
  cohort: string;
  window: string;
  level: CohortLevel;
}): Promise<CohortResidualLeadership> {
  const cohort = params.cohort.trim().toUpperCase();
  const window = params.window.trim().toLowerCase();
  const { level } = params;

  const windowDays = parseWindowDays(window);
  if (windowDays == null) {
    throw new Error(`Invalid window '${params.window}'`);
  }

  const members = await resolveCohortMembers(cohort, level);
  if (members.length === 0) {
    throw new UnknownCohortError(cohort);
  }
  if (members.length < MIN_COHORT_MEMBERS) {
    throw new ThinCohortError(cohort, members.length);
  }

  const windowDates = await resolveWindowDates(cohort, windowDays);
  if (windowDates.length < MIN_WINDOW_OBS) {
    throw new ShortWindowError(cohort, windowDates.length);
  }

  const start_date = windowDates[0]!;
  const end_date = windowDates[windowDates.length - 1]!;
  const windowSet = new Set(windowDates);

  const symbols = members.map((m) => m.symbol);
  const rows: SecurityHistoryRow[] = await fetchBatchHistory(symbols, ["l3_rr"], {
    periodicity: "daily",
    startDate: start_date,
    endDate: end_date,
    orderBy: "asc",
  });

  // Empty batch with a valid zarr key means misconfiguration or total miss —
  // treat every member as short-history rather than inventing a thin ranking.
  const bySymbol = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.metric_key !== "l3_rr") continue;
    if (!windowSet.has(row.teo)) continue;
    if (row.metric_value == null || !Number.isFinite(row.metric_value)) continue;
    let m = bySymbol.get(row.symbol);
    if (!m) {
      m = new Map();
      bySymbol.set(row.symbol, m);
    }
    m.set(row.teo, row.metric_value);
  }

  const rankedRaw: Array<{
    symbol: string; ticker: string; value: number; observed: number;
  }> = [];
  let n_short_history = 0;
  let n_partial = 0;

  for (const member of members) {
    const series = bySymbol.get(member.symbol) ?? new Map();
    const scored = sumResidualOverWindow(series, windowDates);
    if (scored == null) {
      n_short_history += 1;
      continue;
    }
    if (scored.observed < windowDates.length) n_partial += 1;
    rankedRaw.push({
      symbol: member.symbol,
      ticker: member.ticker,
      value: round6(scored.sum),
      observed: scored.observed,
    });
  }

  if (rankedRaw.length < MIN_COHORT_MEMBERS) {
    throw new ThinCohortError(cohort, rankedRaw.length);
  }

  rankedRaw.sort((a, b) => b.value - a.value || a.ticker.localeCompare(b.ticker));

  const ranked: ResidualLeadershipRankedRow[] = rankedRaw.map((r, i) => ({
    symbol: r.symbol,
    ticker: r.ticker,
    rank: i + 1,
    value: r.value,
    // Per-member, because "252 observations" describes the window and not
    // necessarily this row. A consumer that wants to exclude gapped names can;
    // one that does not at least knows they are there.
    observed: r.observed,
  }));

  const values = ranked.map((r) => r.value);
  const sorted = [...values].sort((a, b) => a - b);

  return {
    cohort,
    window,
    level,
    teo: end_date,
    obs: windowDates.length,
    start_date,
    end_date,
    n_ranked: ranked.length,
    n_members: members.length,
    n_short_history,
    //: ranked members carrying at least one missing day, within tolerance.
    n_partial_coverage: n_partial,
    ranked,
    dispersion: {
      best: values[0]!,
      worst: values[values.length - 1]!,
      median: round6(medianOf(sorted)),
      sd: round6(sampleSd(values)),
    },
    prohibited: [
      "not a forecast",
      "not evidence of skill",
      "not a screen",
      "cohort membership is the model's peer mapping, not any fund's holdings",
    ],
  };
}
