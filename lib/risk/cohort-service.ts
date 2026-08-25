/**
 * Cohort service — public surface over the ERM3 cohort store (H.146).
 *
 * This module owns the IP boundary. The store holds 54 cohorts; exactly 12 are
 * public:
 *
 *   L1  SPY                            (market)
 *   L2  XLE XLB XLI XLY XLP XLV XLF XLK XLC XLU XLRE   (GICS sector SPDRs)
 *
 * The 42 L3 subsector cohorts are proprietary curation — the same reasoning
 * that keeps the subsector slate out of `lib/risk/etf-factor-classification.ts`.
 * They are not served, not counted, and not named in responses, errors, schema,
 * or docs. A request for one is indistinguishable from a request for a ticker
 * that does not exist, which is the point: an enumerable "restricted" response
 * would leak the roster one probe at a time.
 *
 * Extending the public set is a product-and-IP decision, not a code change.
 */

import {
  readCohortSeries,
  readCohortCrossSection,
  readCohortRoster,
  readCohortStoreMeta,
  isCohortNumericVar,
  COHORT_NUMERIC_VARS,
  COHORT_DISTRIBUTION_VARS,
  COHORT_BREADTH_VARS,
  type CohortSeries,
  type CohortCrossSectionRow,
  type CohortStoreMeta,
  COHORT_DEPRECATED_VARS,
} from "@/lib/dal/cohort-zarr-reader";
import { ETF_FACTOR_REGISTRY } from "@/lib/risk/etf-factor-classification";
import { getZarrFactorSetId } from "@/lib/zarr-config";

/**
 * The public cohort set, derived from the existing public ETF registry rather
 * than restated — so the two surfaces cannot drift apart, and widening one
 * cannot silently widen the other without an explicit edit there.
 */
export const PUBLIC_COHORT_TICKERS: readonly string[] = ETF_FACTOR_REGISTRY.map((e) => e.ticker);

const PUBLIC_SET = new Set<string>(PUBLIC_COHORT_TICKERS);

export function isPublicCohort(ticker: string): boolean {
  return PUBLIC_SET.has(ticker.trim().toUpperCase());
}

/** Default variable set — the two things the store is for, plus the guards. */
export const DEFAULT_COHORT_VARS: readonly string[] = [
  "residual_mean",
  "residual_sd",
  "mean_pairwise_corr",
  "n_names",
  "n_effective",
];

export const PUBLIC_COHORT_VARS: readonly string[] = COHORT_NUMERIC_VARS;

export interface CohortDisclosures {
  /** Verbatim from the store's own attrs — never a hard-coded copy. */
  no_intercept_contract: string | null;
  return_source_legend: string | null;
  /** Stated, not implied: cohorts cover ~88% of eligible universe names. */
  coverage: string;
  dispersion_use: string;
  er_sign: string;
  /** H.147: what link_fit_resid_sd is (and is not); linked_beta_se is its deprecated alias. */
  link_fit_resid_sd: string;
  thin_cohorts: string;
}

function buildDisclosures(meta: CohortStoreMeta | null): CohortDisclosures {
  return {
    no_intercept_contract: meta?.no_intercept_contract ?? null,
    return_source_legend: meta?.return_source_legend ?? null,
    coverage:
      "Cohorts cover approximately 88% of eligible universe names. The shortfall is names whose sector code maps to no ETF proxy — a real, bounded gap, not a data error. Full factor richness begins around 2006; earlier history leans on proxy or synthetic backfill, flagged per-day by factor_source.",
    dispersion_use:
      "residual_sd measures how much cross-sectional opportunity exists within a cohort. It is a conditioning and allocation variable, not an alpha source — it multiplies skill and cannot create it. Read it alongside mean_pairwise_corr, which separates idiosyncratic dispersion from common movement.",
    link_fit_resid_sd:
      "link_fit_resid_sd is the residual standard deviation of the 252-day link regression (cohort factor on its parent): a fit-quality and dispersion measure, not a standard error of linked_beta and not a total-uncertainty measure. Do not build confidence intervals from it. linked_beta_se is a deprecated alias carrying the same numbers (deprecated 2026-08-25, removed after the next release).",
    er_sign:
      "cohort_ER is an incremental attribution (er_level minus er_prev), not an R-squared share. It can be slightly negative and does not sum to 1. It is the mean member's explained risk at this level, which is a different quantity from linked_beta_r2 (the cohort factor's fit on its parent).",
    thin_cohorts:
      "Statistics on a cohort with few members are noise. Filter with min_names, and prefer n_effective over n_names for anything breadth- or power-related — inverse-Herfindahl breadth is far below the headcount when one constituent dominates.",
  };
}

export interface CohortSeriesResult {
  cohorts: CohortSeries[];
  range: [string, string] | null;
  variables: string[];
  min_names: number;
  universe: string;
  market_factor_etf: string;
  store_build: string | null;
  disclosures: CohortDisclosures;
  data_source: string;
}

export interface CohortCrossSectionResult {
  teo: string;
  cohorts: CohortCrossSectionRow[];
  variables: string[];
  min_names: number;
  universe: string;
  market_factor_etf: string;
  store_build: string | null;
  disclosures: CohortDisclosures;
  data_source: string;
}

export class UnknownCohortError extends Error {
  constructor(public readonly ticker: string) {
    // Deliberately does not distinguish "not a cohort" from "not public".
    super(`Unknown cohort '${ticker}'`);
    this.name = "UnknownCohortError";
  }
}

function resolveVariables(requested?: readonly string[]): string[] {
  if (!requested?.length) return [...DEFAULT_COHORT_VARS];
  const out = requested.map((v) => v.trim()).filter((v) => isCohortNumericVar(v));
  return out.length ? Array.from(new Set(out)) : [...DEFAULT_COHORT_VARS];
}

/** Public tickers only. Throws on anything else, including valid L3 cohorts. */
function resolvePublicTickers(requested?: readonly string[]): string[] {
  if (!requested?.length) return [...PUBLIC_COHORT_TICKERS];
  const out: string[] = [];
  for (const raw of requested) {
    const t = raw.trim().toUpperCase();
    if (!t) continue;
    if (!isPublicCohort(t)) throw new UnknownCohortError(raw.trim());
    out.push(t);
  }
  return Array.from(new Set(out));
}

export class CohortService {
  async getSeries(options: {
    tickers?: string[];
    variables?: string[];
    startDate?: string;
    endDate?: string;
    minNames?: number;
    includeProxySource?: boolean;
  }): Promise<CohortSeriesResult | null> {
    const tickers = resolvePublicTickers(options.tickers);
    const variables = resolveVariables(options.variables);

    const [series, meta] = await Promise.all([
      readCohortSeries({
        tickers,
        variables,
        startDate: options.startDate,
        endDate: options.endDate,
        minNames: options.minNames,
        includeProxySource: options.includeProxySource,
      }),
      readCohortStoreMeta(),
    ]);
    if (!series) return null;

    const dates = series.flatMap((s) => s.points.map((p) => p.date)).sort();
    return {
      cohorts: series,
      range: dates.length ? [dates[0]!, dates[dates.length - 1]!] : null,
      variables,
      min_names: options.minNames ?? 0,
      universe: meta?.universe ?? getZarrFactorSetId(),
      market_factor_etf: meta?.market_factor_etf ?? "SPY",
      store_build: meta?.build_timestamp ?? null,
      disclosures: buildDisclosures(meta),
      data_source: "zarr",
    };
  }

  async getCrossSection(options: {
    tickers?: string[];
    variables?: string[];
    teo?: string;
    minNames?: number;
  }): Promise<CohortCrossSectionResult | null> {
    const tickers = resolvePublicTickers(options.tickers);
    const variables = resolveVariables(options.variables);

    const [snapshot, meta] = await Promise.all([
      readCohortCrossSection({
        tickers,
        variables,
        teo: options.teo,
        minNames: options.minNames,
      }),
      readCohortStoreMeta(),
    ]);
    if (!snapshot) return null;

    return {
      teo: snapshot.teo,
      cohorts: snapshot.rows,
      variables,
      min_names: options.minNames ?? 0,
      universe: meta?.universe ?? getZarrFactorSetId(),
      market_factor_etf: meta?.market_factor_etf ?? "SPY",
      store_build: meta?.build_timestamp ?? null,
      disclosures: buildDisclosures(meta),
      data_source: "zarr",
    };
  }

  /** Public roster — the 12 addressable cohorts and their parent links. */
  async getRoster(): Promise<{
    cohorts: Array<{
      ticker: string;
      level: number;
      parent: string | null;
      valid_from: string | null;
      valid_to: string | null;
    }>;
    variables: { distribution: string[]; breadth: string[]; factor: string[] };
    /** Requestable names that are deprecated aliases, with their replacement and date. */
    deprecated: Readonly<Record<string, { replacement: string; since: string }>>;
    disclosures: CohortDisclosures;
    universe: string;
    panel: [string, string] | null;
  } | null> {
    const [roster, meta] = await Promise.all([readCohortRoster(), readCohortStoreMeta()]);
    if (!roster) return null;

    const cohorts = roster.entries
      .filter((e) => isPublicCohort(e.ticker))
      .sort((a, b) => a.level - b.level || a.ticker.localeCompare(b.ticker))
      .map((e) => ({
        ticker: e.ticker,
        level: e.level,
        parent: e.parentTicker,
        valid_from: e.validFrom,
        valid_to: e.validTo,
      }));

    return {
      cohorts,
      variables: {
        distribution: [...COHORT_DISTRIBUTION_VARS],
        breadth: [...COHORT_BREADTH_VARS],
        factor: [
          "linked_beta",
          "link_fit_resid_sd",
          "linked_beta_se",
          "linked_beta_r2",
          "linked_beta_roll63",
          "cohort_factor_return",
          "cohort_residual_return",
          "cohort_ER",
          "factor_source",
        ],
      },
      deprecated: COHORT_DEPRECATED_VARS,
      disclosures: buildDisclosures(meta),
      universe: meta?.universe ?? getZarrFactorSetId(),
      panel:
        meta?.panel_start && meta?.panel_end ? [meta.panel_start, meta.panel_end] : null,
    };
  }
}

let _service: CohortService | null = null;

export function getCohortService(): CohortService {
  if (!_service) _service = new CohortService();
  return _service;
}
