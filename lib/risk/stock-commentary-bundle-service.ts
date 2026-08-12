/**
 * Stock commentary bundle — one pull for everything a single-name note needs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The BWMACRO stock-commentary runner was stitching metrics + returns-
 * decomposition + rankings + cohort variance-shares + residual-leadership
 * under a 60 req/min ceiling. Twelve names took minutes. The figures all
 * come from the same ERM3 surfaces the existing endpoints already read;
 * this service composes them once per ticker.
 *
 * PARTIAL ENRICHMENT, NOT ALL-OR-NOTHING
 * -------------------------------------
 * Metrics are required (unknown ticker → null from the service → 404 at the
 * route). Return record, standing, cohort shares, and residual rank are
 * optional: a thin cohort or short window becomes `null` on that piece with
 * a refusal reason, never a 422 for the whole bundle. The consumer already
 * refuses individual claims; a missing piece must not kill the risk note.
 *
 * RESPONSE SHAPE
 * --------------
 * `metrics` + `hedge_levels` + `meta` mirror `GET /metrics/{ticker}` enough
 * that `build_stock_evidence` can consume them. `return_record`, `standing`,
 * and `residual_rank` match the dicts the BWMACRO attach_* helpers already
 * expect — so the runner swaps four round-trips for one without rewriting
 * the composer.
 */

import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
  fetchRankingsFromSecurityHistory,
  type RankingResult,
} from "@/lib/dal/risk-engine-v3";
import { buildHedgeLevels, type HedgeLevelsBlock } from "@/lib/risk/hedge-levels";
import {
  computeHedgeRecommendationSnapshot,
} from "@/lib/risk/hedge-recommendation-service";
import { DEFAULT_USER_SEGMENT } from "@/lib/dal/hedge-recommendation";
import {
  getReturnsDecompositionService,
} from "@/lib/risk/returns-decomposition-service";
import {
  getCohortVarianceShares,
  ThinCohortError as ThinVarianceError,
} from "@/lib/risk/cohort-variance-shares-service";
import {
  getCohortResidualLeadership,
  parseWindowDays,
  ThinCohortError as ThinLeadershipError,
  ShortWindowError,
  UnknownCohortError,
  type CohortLevel,
} from "@/lib/risk/cohort-residual-leadership-service";

export { parseWindowDays };

const MIN_OBS = 120;
const ADDITIVITY_TOL = 1e-6;

const METRIC_KEYS = [
  "vol_23d",
  "price_close",
  "market_cap",
  "stock_var",
  "l1_mkt_hr",
  "l1_mkt_er",
  "l1_res_er",
  "l2_mkt_hr",
  "l2_sec_hr",
  "l2_mkt_er",
  "l2_sec_er",
  "l2_res_er",
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
  "l1_mkt_beta",
  "l2_sec_beta",
  "l3_sub_beta",
  "lstar_level",
] as const;

export interface ReturnRecordSummary {
  obs: number;
  start_date: string;
  end_date: string;
  gross_arith: number;
  factor_arith: number;
  specific_arith: number;
  gross_compound: number;
  drawdown: {
    max_drawdown: number;
    trough_index: number;
    peak_index: number;
    underwater_days: number;
    current_drawdown: number;
    recovered: boolean;
    gain_to_breakeven: number;
  };
  drawdown_peak_date: string;
  drawdown_trough_date: string;
  specific_max_drawdown: number;
  specific_current_drawdown: number;
  window: string;
}

export type ReturnRecordRefusal =
  | { insufficient: true; obs: number }
  | { non_additive: true; residual_error: number; obs: number };

export interface StandingBlock {
  rank: number;
  n: number;
  percentile: number | null;
}

export interface CohortStandingSummary {
  teo: string | null;
  gross_return_subsector?: StandingBlock;
  gross_return_sector?: StandingBlock;
  gross_return_universe?: StandingBlock;
  mkt_cap_universe?: StandingBlock;
}

export interface CohortSharesSummary {
  label: string;
  /** Fraction on the same scale as l3_res_er (API variance-shares is percent). */
  residual_mean: number;
  n_names: number;
  teo: string | null;
  level: CohortLevel;
}

export interface ResidualRankSummary {
  cohort_label: string;
  rank: number;
  n: number;
  n_peers_offered: number;
  n_short_history: number | null;
  obs: number;
  value: number;
  best: number;
  worst: number;
  sd: number;
  median: number;
  leaders: string[];
  laggards: string[];
}

export interface CommentaryBundleRefusal {
  piece: string;
  reason: string;
}

export interface StockCommentaryBundle {
  ticker: string;
  symbol: string;
  teo: string;
  window: string;
  /** Flat metrics — abbreviated V3 keys, plus semantic long aliases. */
  metrics: Record<string, number | string | null>;
  hedge_levels: HedgeLevelsBlock;
  meta: {
    sector_etf: string | null;
    subsector_etf: string | null;
  };
  return_record: ReturnRecordSummary | ReturnRecordRefusal | null;
  standing: CohortStandingSummary | null;
  cohort_shares: CohortSharesSummary | null;
  residual_rank: ResidualRankSummary | null;
  coverage: {
    metrics: boolean;
    return_record: boolean;
    standing: boolean;
    cohort_shares: boolean;
    residual_rank: boolean;
  };
  refusals: CommentaryBundleRefusal[];
}

function drawdown(daily: number[]): ReturnRecordSummary["drawdown"] {
  let peak = 1.0;
  let path = 1.0;
  let worst = 0.0;
  let worstI = 0;
  let peakI = 0;
  let runningPeakI = 0;
  let underwater = 0;
  for (let i = 0; i < daily.length; i++) {
    path *= 1.0 + daily[i]!;
    if (path >= peak) {
      peak = path;
      runningPeakI = i;
    } else {
      underwater += 1;
    }
    const dd = path / peak - 1.0;
    if (dd < worst) {
      worst = dd;
      worstI = i;
      peakI = runningPeakI;
    }
  }
  const current = path / peak - 1.0;
  return {
    max_drawdown: worst,
    trough_index: worstI,
    peak_index: peakI,
    underwater_days: underwater,
    current_drawdown: current,
    recovered: current >= 0.0,
    gain_to_breakeven: current < 0 ? 1.0 / (1.0 + current) - 1.0 : 0.0,
  };
}

function compound(xs: number[]): number {
  let c = 1.0;
  for (const v of xs) c *= 1.0 + v;
  return c - 1.0;
}

/**
 * Pure summary of a trailing window — exported for contract tests.
 * Values are SUMS of daily returns (additive); gross_compound is separate.
 */
export function summarizeReturnRecord(
  dates: string[],
  gross: (number | null)[],
  factor: (number | null)[],
  specific: (number | null)[],
  window: string,
  windowDays: number,
): ReturnRecordSummary | ReturnRecordRefusal | null {
  const nAll = dates.length;
  if (!nAll || gross.length !== nAll || factor.length !== nAll || specific.length !== nAll) {
    return null;
  }

  // Trailing windowDays of complete triples.
  const start = Math.max(0, nAll - windowDays);
  const g: number[] = [];
  const f: number[] = [];
  const s: number[] = [];
  const d: string[] = [];
  for (let i = start; i < nAll; i++) {
    const gv = gross[i];
    const fv = factor[i];
    const sv = specific[i];
    if (gv == null || fv == null || sv == null) continue;
    if (!Number.isFinite(gv) || !Number.isFinite(fv) || !Number.isFinite(sv)) continue;
    g.push(gv);
    f.push(fv);
    s.push(sv);
    d.push(dates[i]!);
  }

  if (g.length < MIN_OBS) {
    return { insufficient: true, obs: g.length };
  }

  let worst = 0;
  for (let i = 0; i < g.length; i++) {
    const err = Math.abs(g[i]! - (f[i]! + s[i]!));
    if (err > worst) worst = err;
  }
  if (worst > ADDITIVITY_TOL) {
    return { non_additive: true, residual_error: worst, obs: g.length };
  }

  const dd = drawdown(g);
  const ddS = drawdown(s);
  return {
    obs: g.length,
    start_date: d[0]!,
    end_date: d[d.length - 1]!,
    gross_arith: g.reduce((a, b) => a + b, 0),
    factor_arith: f.reduce((a, b) => a + b, 0),
    specific_arith: s.reduce((a, b) => a + b, 0),
    gross_compound: compound(g),
    drawdown: dd,
    drawdown_peak_date: d[dd.peak_index]!,
    drawdown_trough_date: d[dd.trough_index]!,
    specific_max_drawdown: ddS.max_drawdown,
    specific_current_drawdown: ddS.current_drawdown,
    window,
  };
}

function standingFromRankings(
  rows: RankingResult[],
  window: string,
): CohortStandingSummary | null {
  const out: CohortStandingSummary = { teo: null };
  for (const row of rows) {
    if (row.window !== window) continue;
    if (row.rank_ordinal == null || row.cohort_size == null) continue;
    const blk: StandingBlock = {
      rank: row.rank_ordinal,
      n: row.cohort_size,
      percentile: row.rank_percentile ?? null,
    };
    if (row.metric === "gross_return" && row.cohort === "subsector") {
      out.gross_return_subsector = blk;
    } else if (row.metric === "gross_return" && row.cohort === "sector") {
      out.gross_return_sector = blk;
    } else if (row.metric === "gross_return" && row.cohort === "universe") {
      out.gross_return_universe = blk;
    } else if (row.metric === "mkt_cap" && row.cohort === "universe") {
      out.mkt_cap_universe = blk;
    }
  }
  return out.gross_return_universe || out.gross_return_subsector ? out : null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function withSemanticAliases(
  m: Record<string, number | null | undefined>,
): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = v ?? null;
  }
  // Long aliases the BWMACRO evidence layer also accepts.
  const pairs: Array<[string, string]> = [
    ["l3_mkt_er", "l3_market_er"],
    ["l3_sec_er", "l3_sector_er"],
    ["l3_sub_er", "l3_subsector_er"],
    ["l3_res_er", "l3_residual_er"],
    ["l3_mkt_hr", "l3_market_hr"],
    ["l3_sec_hr", "l3_sector_hr"],
    ["l3_sub_hr", "l3_subsector_hr"],
    ["l1_res_er", "l1_residual_er"],
    ["l2_res_er", "l2_residual_er"],
  ];
  for (const [abbr, full] of pairs) {
    if (out[full] == null && out[abbr] != null) out[full] = out[abbr];
  }
  const lstarLvl = num(m.lstar_level);
  if (lstarLvl === 1) out.lstar = "L1";
  else if (lstarLvl === 2) out.lstar = "L2";
  else if (lstarLvl === 3) out.lstar = "L3";
  return out;
}

function absGross(...hrs: Array<number | null | undefined>): number | null {
  const vals = hrs.filter((h): h is number => h != null && Number.isFinite(h));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + Math.abs(b), 0);
}

/**
 * Assemble the commentary bundle for one ticker. Returns null if the ticker
 * cannot be resolved or has no latest metrics.
 */
export async function getStockCommentaryBundle(params: {
  ticker: string;
  window?: string;
}): Promise<StockCommentaryBundle | null> {
  const ticker = params.ticker.trim().toUpperCase();
  const window = (params.window ?? "252d").trim().toLowerCase();
  const windowDays = parseWindowDays(window);
  if (windowDays == null) {
    throw new Error(`Invalid window '${params.window ?? ""}'`);
  }

  const symbolRecord = await resolveSymbolByTicker(ticker);
  if (!symbolRecord) return null;

  const latest = await fetchLatestMetricsWithFallback(
    symbolRecord.symbol,
    [...METRIC_KEYS],
    "daily",
  );
  if (!latest) return null;

  const m = latest.metrics;
  const sectorEtf = symbolRecord.sector_etf || null;
  const subsectorEtf = symbolRecord.subsector_etf || symbolRecord.sector_etf || null;

  const hedgeRec = computeHedgeRecommendationSnapshot({
    l1_mkt_hr: num(m.l1_mkt_hr),
    l2_mkt_hr: num(m.l2_mkt_hr),
    l2_sec_hr: num(m.l2_sec_hr),
    l3_mkt_hr: num(m.l3_mkt_hr),
    l3_sec_hr: num(m.l3_sec_hr),
    l3_sub_hr: num(m.l3_sub_hr),
    l2_sec_er: num(m.l2_sec_er),
    l3_sub_er: num(m.l3_sub_er),
    user_segment: DEFAULT_USER_SEGMENT,
  });

  const hedge_levels = buildHedgeLevels(
    m,
    {
      market_etf: "SPY",
      sector_etf: sectorEtf,
      subsector_etf: subsectorEtf,
    },
    {
      recommended_level: hedgeRec.recommended_hedge_level,
      statistical_lstar: hedgeRec.lstar,
    },
  );

  const metrics = withSemanticAliases({
    vol_23d: num(m.vol_23d),
    stock_var: num(m.stock_var),
    l1_mkt_hr: num(m.l1_mkt_hr),
    l1_mkt_er: num(m.l1_mkt_er),
    l1_res_er: num(m.l1_res_er),
    l2_mkt_hr: num(m.l2_mkt_hr),
    l2_sec_hr: num(m.l2_sec_hr),
    l2_mkt_er: num(m.l2_mkt_er),
    l2_sec_er: num(m.l2_sec_er),
    l2_res_er: num(m.l2_res_er),
    l3_mkt_hr: num(m.l3_mkt_hr),
    l3_sec_hr: num(m.l3_sec_hr),
    l3_sub_hr: num(m.l3_sub_hr),
    l3_mkt_er: num(m.l3_mkt_er),
    l3_sec_er: num(m.l3_sec_er),
    l3_sub_er: num(m.l3_sub_er),
    l3_res_er: num(m.l3_res_er),
    lstar_level: num(m.lstar_level),
    l2_hedge_gross: absGross(num(m.l2_mkt_hr), num(m.l2_sec_hr)),
    l3_hedge_gross: absGross(num(m.l3_mkt_hr), num(m.l3_sec_hr), num(m.l3_sub_hr)),
  });

  const refusals: CommentaryBundleRefusal[] = [];

  // Parallel enrichment — failures become null pieces, not bundle failure.
  const years = Math.max(1, Math.ceil(windowDays / 252));
  const level: CohortLevel = subsectorEtf ? "subsector" : "sector";
  const cohortEtf = (subsectorEtf || sectorEtf || "").toUpperCase();

  const [decomp, rankingsPack, sharesResult, leadershipResult] = await Promise.all([
    getReturnsDecompositionService()
      .getDecomposition(ticker, "SPY", { years })
      .catch(() => null),
    fetchRankingsFromSecurityHistory(symbolRecord.symbol, {
      window,
    }).catch(() => ({ teo: null, rankings: [] as RankingResult[] })),
    cohortEtf
      ? getCohortVarianceShares({
          cohort: cohortEtf,
          level,
          excludeSymbol: symbolRecord.symbol,
        }).catch((e: unknown) => e)
      : Promise.resolve(null),
    cohortEtf
      ? getCohortResidualLeadership({
          cohort: cohortEtf,
          window,
          level,
        }).catch((e: unknown) => e)
      : Promise.resolve(null),
  ]);

  // Trailing vol from the same series the return record uses — no extra pull.
  if (decomp?.returns_gross?.length) {
    const rets = decomp.returns_gross
      .slice(-windowDays)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (rets.length >= 20) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance =
        rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
      metrics.vol_252d_ann = Math.sqrt(variance) * Math.sqrt(252);
    }
  }
  let return_record: StockCommentaryBundle["return_record"] = null;
  if (decomp && decomp.dates.length) {
    return_record = summarizeReturnRecord(
      decomp.dates,
      decomp.returns_gross,
      decomp.l3_cfr,
      decomp.l3_rr,
      window,
      windowDays,
    );
    if (return_record && "insufficient" in return_record) {
      refusals.push({
        piece: "return_record",
        reason: `only ${return_record.obs} observations in the window`,
      });
    } else if (return_record && "non_additive" in return_record) {
      refusals.push({
        piece: "return_record",
        reason: "daily factor + residual no longer sum to gross",
      });
    }
  } else {
    refusals.push({ piece: "return_record", reason: "returns decomposition unavailable" });
  }

  const standing = standingFromRankings(rankingsPack?.rankings ?? [], window);
  if (standing && !standing.teo && rankingsPack?.teo) {
    standing.teo = rankingsPack.teo;
  }
  if (!standing) {
    refusals.push({ piece: "standing", reason: "no rankings for this window" });
  }

  let cohort_shares: CohortSharesSummary | null = null;
  if (sharesResult instanceof ThinVarianceError) {
    refusals.push({
      piece: "cohort_shares",
      reason: sharesResult.message,
    });
  } else if (
    sharesResult &&
    typeof sharesResult === "object" &&
    "equal_weighted_mean" in sharesResult
  ) {
    const s = sharesResult as Awaited<ReturnType<typeof getCohortVarianceShares>>;
    cohort_shares = {
      label: s.cohort,
      residual_mean: s.equal_weighted_mean.residual_er_pct / 100.0,
      n_names: s.n_names,
      teo: s.teo,
      level: s.level,
    };
  } else if (!cohortEtf) {
    refusals.push({ piece: "cohort_shares", reason: "no sector/subsector ETF on symbol" });
  } else if (sharesResult instanceof Error) {
    refusals.push({ piece: "cohort_shares", reason: sharesResult.message });
  }

  let residual_rank: ResidualRankSummary | null = null;
  if (
    leadershipResult instanceof ThinLeadershipError ||
    leadershipResult instanceof ShortWindowError ||
    leadershipResult instanceof UnknownCohortError
  ) {
    refusals.push({
      piece: "residual_rank",
      reason: leadershipResult.message,
    });
  } else if (
    leadershipResult &&
    typeof leadershipResult === "object" &&
    "ranked" in leadershipResult
  ) {
    const lead = leadershipResult as Awaited<
      ReturnType<typeof getCohortResidualLeadership>
    >;
    const me = lead.ranked.find((r) => r.ticker === ticker);
    const d = lead.dispersion;
    if (
      me &&
      d.best != null &&
      d.worst != null &&
      d.median != null &&
      d.sd != null
    ) {
      residual_rank = {
        cohort_label: lead.cohort,
        rank: me.rank,
        n: lead.n_ranked,
        n_peers_offered: lead.n_members,
        n_short_history: lead.n_short_history,
        obs: lead.obs,
        value: me.value,
        best: d.best,
        worst: d.worst,
        sd: d.sd,
        median: d.median,
        leaders: lead.ranked.slice(0, 3).map((r) => r.ticker),
        laggards: lead.ranked.slice(-3).map((r) => r.ticker),
      };
    } else {
      refusals.push({
        piece: "residual_rank",
        reason: me
          ? "dispersion incomplete"
          : "ticker absent from its cohort ranking",
      });
    }
  } else if (!cohortEtf) {
    refusals.push({ piece: "residual_rank", reason: "no sector/subsector ETF on symbol" });
  } else if (leadershipResult instanceof Error) {
    refusals.push({ piece: "residual_rank", reason: leadershipResult.message });
  }

  const recordOk =
    !!return_record &&
    !("insufficient" in return_record) &&
    !("non_additive" in return_record);

  return {
    ticker,
    symbol: symbolRecord.symbol,
    teo: latest.teo,
    window,
    metrics,
    hedge_levels,
    meta: { sector_etf: sectorEtf, subsector_etf: subsectorEtf },
    return_record,
    standing,
    cohort_shares,
    residual_rank,
    coverage: {
      metrics: true,
      return_record: recordOk,
      standing: !!standing,
      cohort_shares: !!cohort_shares,
      residual_rank: !!residual_rank,
    },
    refusals,
  };
}
