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

export interface CohortVarianceShares {
  cohort: string;
  level: CohortLevel;
  /** Peers with a usable decomposition — the denominator of every mean. */
  n_names: number;
  /** Names in the cohort before the decomposition filter. */
  n_universe: number;
  teo: string | null;
  /** Means, in percent. Sum to ~100 by construction. */
  market_er_pct: number;
  sector_er_pct: number;
  subsector_er_pct: number;
  residual_er_pct: number;
  /** Sum of the four, returned so a consumer can assert the identity. */
  sum_pct: number;
  aggregate: "mean";
  disclosures: {
    aggregate: string;
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

  let n = 0;
  let mkt = 0;
  let sec = 0;
  let sub = 0;
  let res = 0;
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
    n += 1;
    mkt += m.l3_mkt_er;
    sec += m.l3_sec_er;
    sub += m.l3_sub_er;
    res += m.l3_res_er;
    // Latest teo across contributors, so a consumer can check the peer row is
    // not a different date from the entity bar beside it.
    if (!teo || row.teo > teo) teo = row.teo;
  }

  if (n < MIN_COHORT_MEMBERS) throw new ThinCohortError(cohort, n);

  const pct = (v: number) => Math.round((v / n) * 1e6) / 1e4;
  const out = {
    market_er_pct: pct(mkt),
    sector_er_pct: pct(sec),
    subsector_er_pct: pct(sub),
    residual_er_pct: pct(res),
  };

  return {
    cohort: cohort.trim().toUpperCase(),
    level,
    n_names: n,
    n_universe: symbols.length,
    teo,
    ...out,
    sum_pct:
      Math.round(
        (out.market_er_pct +
          out.sector_er_pct +
          out.subsector_er_pct +
          out.residual_er_pct) *
          1e4,
      ) / 1e4,
    aggregate: "mean" as const,
    disclosures: {
      aggregate:
        "Means, not medians. Each name's four shares sum to 1, so the mean of " +
        "those shares also sums to 1 and describes a real composition; four " +
        "medians would each come from a different name and describe no actual " +
        "portfolio. The mean is outlier-sensitive — read it with n_names.",
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
