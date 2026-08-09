/**
 * Peer variance shares for a cohort — the comparison bar's only honest source.
 *
 * WHY THIS EXISTS, AND WHY NOT `cohort_ER`
 * ----------------------------------------
 * The product wants one thing: "is this manager actually picking stocks, or
 * hugging its index?" That is a comparison of the SAME decomposition — market /
 * sector / subsector / residual shares of variance — between an entity and its
 * peers.
 *
 * The cohort store cannot answer it. `cohort_ER` is an incremental attribution
 * (er_level minus er_prev), can be slightly negative, and does not sum to 1 —
 * the store's own disclosure says so, and calls it "a different quantity from
 * linked_beta_r2". Drawing it beneath a variance-share bar would stack two
 * different constructions in one picture, which a reader would inevitably read
 * as like-for-like.
 *
 * So the peer figures are built from the same per-name `l3_*_er` fields the
 * entity bar renders, aggregated. One construction, both bars.
 *
 * MEAN, NOT MEDIAN — deliberately
 * -------------------------------
 * Each constituent's four shares sum to 1, so the MEAN of those shares also
 * sums to 1 and describes a real composition. A median does not: it picks a
 * different name for each leg, so the four medians describe no actual
 * portfolio. Measured on three XBI names at teo 2026-08-06 the medians summed
 * to 100.45% while the means summed to 100.00%. The peer row is drawn as a
 * stacked bar beside the entity's, and a stacked bar whose segments do not sum
 * is quietly wrong.
 *
 * The mean's cost is outlier sensitivity, and it is handled by disclosure
 * rather than construction: `n_names` is returned and a floor is enforced. If
 * robustness is wanted later, a trimmed mean keeps the identity; a median does
 * not.
 *
 * Shares may be slightly NEGATIVE (INCY's market share was -0.01% on the sample
 * above), so nothing here assumes non-negative segments.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";

/**
 * Below this many peers with a usable decomposition, the statistic is refused
 * rather than returned. Mirrors the cohort store's own guidance that
 * "statistics on a cohort with few members are noise".
 */
export const MIN_COHORT_MEMBERS = 20;

export type CohortLevel = "sector" | "subsector";

/** One leg's marginal distribution across the cohort, in percent. */
export interface LegQuartiles {
  p25: number;
  p50: number;
  p75: number;
}

/** The four legs, in percent, plus their sum. */
export interface LegMeans {
  market_er_pct: number;
  sector_er_pct: number;
  subsector_er_pct: number;
  residual_er_pct: number;
  sum_pct: number;
}

export interface CohortVarianceShares {
  cohort: string;
  level: CohortLevel;
  /** Peers with a usable decomposition — the denominator of every statistic. */
  n_names: number;
  /** Names in the cohort before the decomposition filter. */
  n_universe: number;
  /** Peers that also carried a usable weight — the AUM-weighted denominator. */
  n_weighted: number;
  teo: string | null;

  /**
   * PRIMARY (CEO ruling 2026-08-07). Equal-weighted marginal quartiles per leg.
   * Marginal means each leg's quartiles are computed over that leg alone, so
   * the four p50s come from four different names and DO NOT sum to 100.
   */
  quartiles: {
    market_er_pct: LegQuartiles;
    sector_er_pct: LegQuartiles;
    subsector_er_pct: LegQuartiles;
    residual_er_pct: LegQuartiles;
    /** Sum of the four medians. Diagnostic — it is not expected to be 100. */
    p50_sum_pct: number;
  };

  /** SECONDARY (CEO ruling). Weighted by market cap; sums to 100. */
  aum_weighted_mean: LegMeans;

  /** Equal-weighted mean; sums to 100. What a stacked peer bar should draw. */
  equal_weighted_mean: LegMeans;

  disclosures: {
    primary: string;
    marginal_quartiles: string;
    weighting: string;
    coverage: string;
    sign: string;
  };
}

export class ThinCohortError extends Error {
  constructor(
    readonly cohort: string,
    readonly nNames: number,
  ) {
    super(
      `Cohort ${cohort} has ${nNames} members with a usable decomposition, ` +
        `below the ${MIN_COHORT_MEMBERS} needed to report a peer statistic.`,
    );
    this.name = "ThinCohortError";
  }
}

/**
 * Symbols whose sector or subsector proxy is `etf`.
 *
 * Membership is the `symbols` table's own classification, the same one
 * `resolveSectorSymbolSet` uses for ranking screens — so a cohort here and a
 * cohort there cannot disagree about who is in it.
 */
async function resolveCohortSymbols(
  etf: string,
  level: CohortLevel,
  excludeSymbol?: string | null,
): Promise<string[]> {
  const upper = etf.trim().toUpperCase();
  if (!upper) return [];
  const column = level === "sector" ? "sector_etf" : "subsector_etf";

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("symbols")
    .select("symbol")
    .eq(column, upper);

  if (error) {
    console.error(`[cohort-shares] ${column}=${upper} lookup failed:`, error);
    return [];
  }
  return (data ?? [])
    .map((r) => (r as { symbol: string }).symbol)
    .filter((s): s is string => Boolean(s) && s !== excludeSymbol);
}

/**
 * Mean variance shares across a cohort.
 *
 * `excludeSymbol` takes the subject out of its own peer set — leaving it in
 * biases the comparison toward the very name being compared, and on a thin
 * cohort visibly so.
 */
export async function getCohortVarianceShares(params: {
  cohort: string;
  level: CohortLevel;
  excludeSymbol?: string | null;
}): Promise<CohortVarianceShares> {
  const { cohort, level, excludeSymbol } = params;

  const symbols = await resolveCohortSymbols(cohort, level, excludeSymbol);
  if (symbols.length === 0) throw new ThinCohortError(cohort, 0);

  const batch = await fetchBatchLatestSummary(symbols, "daily");

  const legs: number[][] = [[], [], [], []];
  const weights: number[] = [];
  let teo: string | null = null;

  for (const [, row] of batch) {
    const m = row.metrics;
    // All four legs must be present. A name contributing three of four would
    // silently shift the composition and break the identity the bar relies on.
    if (
      m.l3_mkt_er == null ||
      m.l3_sec_er == null ||
      m.l3_sub_er == null ||
      m.l3_res_er == null
    ) {
      continue;
    }
    legs[0]!.push(m.l3_mkt_er);
    legs[1]!.push(m.l3_sec_er);
    legs[2]!.push(m.l3_sub_er);
    legs[3]!.push(m.l3_res_er);
    // A name with no usable size contributes to the equal-weighted statistics
    // and is skipped by the weighted one, rather than being dropped entirely
    // or silently given zero weight.
    const cap = m.market_cap;
    weights.push(typeof cap === "number" && cap > 0 ? cap : 0);
    // Latest teo across contributors, so a consumer can check the peer row is
    // not a different date from the entity bar beside it.
    if (!teo || row.teo > teo) teo = row.teo;
  }

  const n = legs[0]!.length;
  if (n < MIN_COHORT_MEMBERS) throw new ThinCohortError(cohort, n);

  const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const toPct = (v: number) => round4(v * 100);

  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  /**
   * Linear-interpolated quantile (R type 7 / numpy default), stated because a
   * quartile is not well defined without one and two consumers using different
   * conventions would disagree on the same data.
   */
  const quantile = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b);
    const h = (s.length - 1) * q;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return s[lo]! + (s[hi]! - s[lo]!) * (h - lo);
  };

  const legQuartiles = (xs: number[]): LegQuartiles => ({
    p25: toPct(quantile(xs, 0.25)),
    p50: toPct(quantile(xs, 0.5)),
    p75: toPct(quantile(xs, 0.75)),
  });

  const asMeans = (vals: number[]): LegMeans => {
    const [mk, se, su, re] = vals.map(toPct) as [number, number, number, number];
    return {
      market_er_pct: mk,
      sector_er_pct: se,
      subsector_er_pct: su,
      residual_er_pct: re,
      sum_pct: round4(mk + se + su + re),
    };
  };

  const equal = asMeans(legs.map(meanOf));

  // Weighted by market cap. A weighted average of compositions that each sum
  // to 1 also sums to 1, so this is a drawable stacked bar too.
  const wTotal = weights.reduce((a, b) => a + b, 0);
  const nWeighted = weights.filter((w) => w > 0).length;
  const weighted =
    wTotal > 0
      ? asMeans(
          legs.map(
            (xs) => xs.reduce((acc, v, i) => acc + v * weights[i]!, 0) / wTotal,
          ),
        )
      : equal;

  const q = {
    market_er_pct: legQuartiles(legs[0]!),
    sector_er_pct: legQuartiles(legs[1]!),
    subsector_er_pct: legQuartiles(legs[2]!),
    residual_er_pct: legQuartiles(legs[3]!),
  };

  return {
    cohort: cohort.trim().toUpperCase(),
    level,
    n_names: n,
    n_universe: symbols.length,
    n_weighted: nWeighted,
    teo,
    quartiles: {
      ...q,
      p50_sum_pct: round4(
        q.market_er_pct.p50 +
          q.sector_er_pct.p50 +
          q.subsector_er_pct.p50 +
          q.residual_er_pct.p50,
      ),
    },
    aum_weighted_mean: weighted,
    equal_weighted_mean: equal,
    disclosures: {
      primary:
        "Equal-weighted marginal quartiles are the primary statistic; the " +
        "AUM-weighted mean is secondary and labelled as such.",
      marginal_quartiles:
        "Quartiles are MARGINAL — each leg's quartiles are computed over that " +
        "leg alone, so the four medians come from four different names and do " +
        "NOT sum to 100 (p50_sum_pct reports the actual figure). They " +
        "describe the spread of each leg across the cohort, not a portfolio. " +
        "Anything drawn as a stacked bar must use one of the means, whose " +
        "segments do sum. Quantiles are linear-interpolated (R type 7).",
      weighting:
        "aum_weighted_mean is weighted by market_cap, the size measure carried " +
        "per name. Names with no usable size contribute to the equal-weighted " +
        "statistics and are excluded from the weighted one; n_weighted is that " +
        "denominator. Both means sum to 100 because each constituent does.",
      coverage:
        "Peers are names whose sector_etf/subsector_etf matches this cohort " +
        "AND which carry all four L3 explained-risk legs at the latest teo. " +
        "n_universe is the cohort before that filter.",
      sign:
        "Explained-risk shares can be slightly negative; they are not clipped. " +
        "A consumer drawing a stacked bar must handle a negative segment.",
    },
  };
}
