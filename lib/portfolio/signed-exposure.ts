/**
 * Signed (long/short) portfolio exposure and L3 risk — pure math, no I/O.
 *
 * Used by POST /api/portfolio/exposure. Positions are signed dollar values
 * (short < 0). Nothing is normalised: a book that nets to ~0 is a valid input.
 *
 * Conventions (lib/api/hedge-map.ts): a layer hedge ratio `hr` is the ETF
 * dollar position per $1 long stock that hedges that layer, so
 * `l1_mkt_hr ≈ -l1_mkt_beta`. For a book:
 *
 *   stock hedge trade   H_e = Σ_i v_i · hr_{i,e}        (per ETF e, per level)
 *   stock ETF exposure  x_stock = -H
 *   direct ETF holding  d_e  (the book's own SPY / XLK / … positions)
 *   total ETF exposure  x = x_stock + d
 *   neutralising trade  T = -x = H - d
 *
 * Basis. By default each name is hedged at its own L* level (`lstar_level`,
 * 1–3): L* stops above a layer that adds no explanatory value, which is where
 * negative incremental ER shares come from. `l1` / `l2` / `l3` force one level
 * for every name. Levels never go past L3: size/value style is not modelled
 * here; it stays in the residual.
 *
 *   systematic daily variance  = xᵀ Σ x     (Σ = sample cov of raw ETF daily returns)
 *   layer contribution         C_L = x_Lᵀ Σ x, Σ_L C_L = xᵀ Σ x  (can be negative)
 *   residual daily variance    ≈ Σ_i v_i² · stock_var_i · max(lK_res_er_i, 0)  (K = the name's level)
 *       — a diagonal approximation: it ignores residual covariance across
 *         names, including common size/value exposure. Not a bound.
 *
 * lK_res_er is ERM3's residual share: 1 minus the variance the held (time-
 * varying) hedge removed over the window. The shares at a level sum to 1, but
 * one can be negative when a hedge leg added variance, so the residual share
 * can exceed 1. That is a real result and is used as is (and reported); only a
 * negative residual share, which would subtract variance, is floored at 0 for
 * the variance term. The stored shares are never altered.
 */

export type Level = "l1" | "l2" | "l3";
export type Basis = "lstar" | Level;
export type Layer = "market" | "sector" | "subsector";

export const MARKET_ETF = "SPY";
export const TRADING_DAYS = 252;

/** Residual share above 1 by more than this: the hedge added variance. */
const HEDGE_ADDED_EPS = 1e-6;
/** Residual share above this is used but reported as a data-quality warning. */
const RES_ER_EXTREME = 2;

export interface ExposureWarning {
  code: string;
  message: string;
  tickers: string[];
}

export interface StockInput {
  symbol: string;
  /** Tickers as submitted that netted into this symbol. */
  tickers: string[];
  value: number;
  sector_etf: string | null;
  subsector_etf: string | null;
  metrics: Record<string, number | null | undefined>;
}

export interface DirectEtfInput {
  ticker: string;
  value: number;
}

export interface EtfCovariance {
  etfs: string[];
  /** Daily sample covariance (N-1), symmetric. */
  S: number[][];
  start: string | null;
  end: string | null;
  requested_n: number;
  effective_n: number;
}

export interface ExposureInput {
  stocks: StockInput[];
  directEtfs: DirectEtfInput[];
  /** Σ|v| over the submitted rows — the coverage denominator. */
  inputGrossUsd: number;
  cov: EtfCovariance | null;
  /** Default "lstar": each name at its own L* level. */
  basis?: Basis;
  topContributors?: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function addTo(map: Record<string, number>, key: string, v: number) {
  map[key] = (map[key] ?? 0) + v;
}

function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function roundMap(m: Record<string, number>, dp = 2): Record<string, number> {
  return Object.fromEntries(
    Object.entries(m)
      .filter(([, v]) => v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, v]) => [k, round(v, dp)]),
  );
}

/** ETF legs for one stock at one level: [etf, layer, hr]. Null when any leg is missing. */
export function stockLegs(s: StockInput, level: Level): Array<[string, Layer, number]> | null {
  const m = s.metrics;
  if (level === "l1") {
    return finite(m.l1_mkt_hr) ? [[MARKET_ETF, "market", m.l1_mkt_hr]] : null;
  }
  if (level === "l2") {
    if (!s.sector_etf || !finite(m.l2_mkt_hr) || !finite(m.l2_sec_hr)) return null;
    return [
      [MARKET_ETF, "market", m.l2_mkt_hr],
      [s.sector_etf, "sector", m.l2_sec_hr],
    ];
  }
  const sub = s.subsector_etf ?? s.sector_etf;
  if (!s.sector_etf || !sub || !finite(m.l3_mkt_hr) || !finite(m.l3_sec_hr) || !finite(m.l3_sub_hr)) {
    return null;
  }
  return [
    [MARKET_ETF, "market", m.l3_mkt_hr],
    [s.sector_etf, "sector", m.l3_sec_hr],
    [sub, "subsector", m.l3_sub_hr],
  ];
}

const resKey = (level: Level) => `${level}_res_er`;

function levelUsable(s: StockInput, level: Level): boolean {
  return stockLegs(s, level) !== null && finite(s.metrics[resKey(level)]);
}

export type ExclusionReason = "no_lstar" | "lstar_level_incomplete";

/**
 * The level a name is hedged and measured at. Under "lstar" that is its own
 * `lstar_level`. There is no fallback: every level uses the same estimation
 * window, so a name without an L* (too little history) has no L1 either
 * (checked 2026-10-08: 350 of 350 such names had no L1 data). Such names are
 * excluded and reported.
 */
export function resolveLevel(
  s: StockInput,
  basis: Basis,
): { level: Level | null; reason: ExclusionReason | null } {
  if (basis !== "lstar") return { level: basis, reason: null };
  const ls = s.metrics.lstar_level;
  if (!finite(ls) || ls < 1 || ls > 3) return { level: null, reason: "no_lstar" };
  const level = `l${Math.round(ls)}` as Level;
  return levelUsable(s, level) ? { level, reason: null } : { level: null, reason: "lstar_level_incomplete" };
}

function quadForm(a: number[], S: number[][], b: number[]): number {
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    let row = 0;
    for (let j = 0; j < b.length; j++) row += S[i]![j]! * b[j]!;
    out += a[i]! * row;
  }
  return out;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function volBlock(dailyVar: number) {
  const v = Math.max(dailyVar, 0);
  const daily = Math.sqrt(v);
  return {
    daily_variance_usd2: dailyVar,
    daily_vol_usd: round(daily),
    annual_vol_usd: round(daily * Math.sqrt(TRADING_DAYS)),
  };
}

export function computeSignedExposure(input: ExposureInput) {
  const { stocks, directEtfs, cov } = input;
  const gross = input.inputGrossUsd;
  const share = (covered: number) => (gross > 0 ? round(covered / gross, 4) : null);
  const absSum = (xs: Array<{ value: number }>) => xs.reduce((a, s) => a + Math.abs(s.value), 0);

  // ---- 1. beta-dollars -------------------------------------------------------
  let stockBeta = 0;
  let betaCovered = 0;
  const betaBySector: Record<string, number> = {};
  for (const s of stocks) {
    const b = s.metrics.l1_mkt_beta;
    if (!finite(b)) continue;
    stockBeta += s.value * b;
    betaCovered += Math.abs(s.value);
    addTo(betaBySector, s.sector_etf ?? "unclassified", s.value * b);
  }

  const covIdx = new Map((cov?.etfs ?? []).map((e, i) => [e, i]));
  const spyIdx = covIdx.get(MARKET_ETF);
  let directBeta = 0;
  let directBetaCovered = 0;
  const directBetas: Record<string, number | null> = {};
  for (const d of directEtfs) {
    let beta: number | null = null;
    if (d.ticker === MARKET_ETF) beta = 1;
    else if (cov && spyIdx !== undefined && covIdx.has(d.ticker)) {
      const varSpy = cov.S[spyIdx]![spyIdx]!;
      if (varSpy > 0) beta = cov.S[covIdx.get(d.ticker)!]![spyIdx]! / varSpy;
    }
    directBetas[d.ticker] = beta === null ? null : round(beta, 4);
    if (beta !== null) {
      directBeta += d.value * beta;
      directBetaCovered += Math.abs(d.value);
    }
  }

  // ---- 2. hedge trades per level ----------------------------------------------
  const directExposure: Record<string, number> = {};
  for (const d of directEtfs) addTo(directExposure, d.ticker, d.value);

  const hedges: Record<Level | "lstar", unknown> = {} as Record<Level | "lstar", unknown>;
  const hedgeCovered: Record<Level, number> = { l1: 0, l2: 0, l3: 0 };
  for (const level of ["l1", "l2", "l3"] as Level[]) {
    const stockTrade: Record<string, number> = {};
    for (const s of stocks) {
      const legs = stockLegs(s, level);
      if (!legs) continue;
      hedgeCovered[level] += Math.abs(s.value);
      for (const [etf, , hr] of legs) addTo(stockTrade, etf, s.value * hr);
    }
    const total: Record<string, number> = { ...stockTrade };
    for (const [etf, v] of Object.entries(directExposure)) addTo(total, etf, -v);
    hedges[level] = {
      stock_hedge_trade_usd: roundMap(stockTrade),
      direct_etf_exposure_usd: roundMap(directExposure),
      total_neutralizing_trade_usd: roundMap(total),
      stock_gross_covered_usd: round(hedgeCovered[level]),
    };
  }

  // Per-name level for the selected basis (drives the "lstar" hedge and the risk split).
  const basis: Basis = input.basis ?? "lstar";
  const levelOf = new Map<string, Level>();
  const levelCounts: Record<Level, number> = { l1: 0, l2: 0, l3: 0 };
  const lstarExcluded: Array<{ ticker: string; value_usd: number; reason: ExclusionReason }> = [];
  for (const s of stocks) {
    const { level, reason } = resolveLevel(s, basis);
    if (level) {
      levelOf.set(s.symbol, level);
      levelCounts[level] += 1;
    }
    if (reason) lstarExcluded.push({ ticker: s.tickers[0] ?? s.symbol, value_usd: round(s.value), reason });
  }
  let lstarCovered = 0;
  {
    const stockTrade: Record<string, number> = {};
    let covered = 0;
    for (const s of stocks) {
      const level = levelOf.get(s.symbol);
      const legs = level ? stockLegs(s, level) : null;
      if (!legs) continue;
      covered += Math.abs(s.value);
      for (const [etf, , hr] of legs) addTo(stockTrade, etf, s.value * hr);
    }
    const total: Record<string, number> = { ...stockTrade };
    for (const [etf, v] of Object.entries(directExposure)) addTo(total, etf, -v);
    hedges.lstar = {
      stock_hedge_trade_usd: roundMap(stockTrade),
      direct_etf_exposure_usd: roundMap(directExposure),
      total_neutralizing_trade_usd: roundMap(total),
      stock_gross_covered_usd: round(covered),
      names_by_level: levelCounts,
    };
    lstarCovered = covered;
  }

  // ---- 3. L3 risk ---------------------------------------------------------------
  const uncoveredEtfs = new Set<string>();
  let risk: Record<string, unknown> | null = null;
  let systematicCovered = 0;
  let residualCovered = 0;
  let totalRiskCovered = 0;
  const residualFlagged: Array<{ ticker: string; reason: string }> = [];
  const hedgeAddedVariance: Array<{ ticker: string; level: Level; residual_share: number }> = [];
  const floored: string[] = [];
  const extreme: string[] = [];

  // Residual (diagonal approximation) — independent of the covariance.
  let residVar = 0;
  const residByName: Array<{ ticker: string; value: number; var: number }> = [];
  const residOk = new Set<string>();
  for (const s of stocks) {
    const level = levelOf.get(s.symbol);
    if (!level) continue;
    const sv = s.metrics.stock_var;
    const res = s.metrics[resKey(level)];
    const label = s.tickers[0] ?? s.symbol;
    if (!finite(sv) || !finite(res)) continue;
    if (sv < 0) {
      residualFlagged.push({ ticker: label, reason: "negative stock_var" });
      continue;
    }
    if (res < 0) floored.push(label);
    if (res > 1 + HEDGE_ADDED_EPS) hedgeAddedVariance.push({ ticker: label, level, residual_share: round(res, 4) });
    if (res > RES_ER_EXTREME) extreme.push(label);
    const v = s.value * s.value * sv * Math.max(res, 0);
    residVar += v;
    residualCovered += Math.abs(s.value);
    residOk.add(s.symbol);
    residByName.push({ ticker: label, value: s.value, var: v });
  }

  if (cov && cov.etfs.length > 0) {
    const n = cov.etfs.length;
    const zero = () => new Array<number>(n).fill(0);
    const xLayer: Record<Layer | "direct_etf", number[]> = {
      market: zero(),
      sector: zero(),
      subsector: zero(),
      direct_etf: zero(),
    };

    const recon: number[] = [];
    for (const s of stocks) {
      const level = levelOf.get(s.symbol);
      const legs = level ? stockLegs(s, level) : null;
      if (!legs || !level) continue;
      if (legs.some(([etf]) => !covIdx.has(etf))) {
        for (const [etf] of legs) if (!covIdx.has(etf)) uncoveredEtfs.add(etf);
        continue;
      }
      const own = zero();
      for (const [etf, layer, hr] of legs) {
        const i = covIdx.get(etf)!;
        xLayer[layer][i] -= s.value * hr;
        own[i] -= hr;
      }
      systematicCovered += Math.abs(s.value);
      if (residOk.has(s.symbol)) totalRiskCovered += Math.abs(s.value);

      // Reconciliation: model-implied systematic variance of $1 of this stock
      // under the new covariance vs the model's own split stock_var·(1 - res).
      const sv = s.metrics.stock_var;
      const res = s.metrics[resKey(level)];
      if (finite(sv) && finite(res) && sv > 0) {
        const modelSys = sv * (1 - res);
        if (modelSys > 0) recon.push(Math.abs(quadForm(own, cov.S, own) - modelSys) / modelSys);
      }
    }
    for (const d of directEtfs) {
      const i = covIdx.get(d.ticker);
      if (i === undefined) {
        uncoveredEtfs.add(d.ticker);
        continue;
      }
      xLayer.direct_etf[i] += d.value;
      systematicCovered += Math.abs(d.value);
      totalRiskCovered += Math.abs(d.value);
    }

    const x = zero();
    for (const layer of Object.keys(xLayer) as Array<keyof typeof xLayer>) {
      for (let i = 0; i < n; i++) x[i] += xLayer[layer][i]!;
    }
    const sysVar = quadForm(x, cov.S, x);
    const sysDefined = sysVar > 1e-12;
    const contributions = Object.fromEntries(
      (Object.keys(xLayer) as Array<keyof typeof xLayer>).map((layer) => {
        const c = quadForm(xLayer[layer], cov.S, x);
        return [layer, { daily_variance_usd2: c, share_of_systematic: sysDefined ? round(c / sysVar, 4) : null }];
      }),
    );

    const totalVar = sysVar + residVar;
    recon.sort((a, b) => a - b);
    risk = {
      basis,
      names_by_level: levelCounts,
      systematic: {
        ...volBlock(sysVar),
        exposure_usd: roundMap(Object.fromEntries(cov.etfs.map((e, i) => [e, x[i]!]))),
        layer_contributions: contributions,
        note: "Raw-ETF hedge-leg contributions (Euler, x_Lᵀ Σ x). They sum to the systematic variance and can be negative; they are not ERM3's orthogonal explained-risk shares.",
      },
      residual: {
        ...volBlock(residVar),
        method: "residual_variance_diagonal_approximation",
        level_basis: basis,
        note: "Σ v²·stock_var·max(lK_res_er, 0), K = each name's level under the basis. lK_res_er is the model's residual share at that level (the shares at a level sum to 1); above 1 means the hedge added variance over the window, and it is used as is. Ignores residual covariance across names, including common size/value exposure that stays in the residual. An approximation, not a bound.",
        hedge_added_variance: hedgeAddedVariance,
        top_contributors: residByName
          .sort((a, b) => b.var - a.var)
          .slice(0, input.topContributors ?? 15)
          .map((r) => ({
            ticker: r.ticker,
            value_usd: round(r.value),
            share_of_residual: residVar > 0 ? round(r.var / residVar, 4) : null,
          })),
      },
      total: {
        ...volBlock(totalVar),
        systematic_share: totalVar > 0 ? round(sysVar / totalVar, 4) : null,
        residual_share: totalVar > 0 ? round(residVar / totalVar, 4) : null,
      },
      reconciliation: {
        description: "Per name at its level K: |(-hr)ᵀ Σ (-hr) − stock_var·(1 − lK_res_er)| / stock_var·(1 − lK_res_er). Large values mean the new covariance and the model's own variance split disagree for that name.",
        names: recon.length,
        median_relative_error: quantile(recon, 0.5),
        p90_relative_error: quantile(recon, 0.9),
      },
    };
  }

  const warnings: ExposureWarning[] = [];
  if (hedgeAddedVariance.length) {
    warnings.push({
      code: "hedge_added_variance",
      message: "For these names the model's hedge at their level added variance over the window (residual share above 1). Their residual risk is larger than their unhedged variance and is used as is.",
      tickers: hedgeAddedVariance.map((h) => h.ticker),
    });
  }
  if (extreme.length) {
    warnings.push({
      code: "residual_share_extreme",
      message: `Residual share above ${RES_ER_EXTREME} (the hedge more than doubled variance). Used as is; check these names before relying on the residual total.`,
      tickers: extreme,
    });
  }
  if (floored.length) {
    warnings.push({
      code: "residual_share_floored",
      message: "Residual share below 0 for these names; their residual variance is taken as 0.",
      tickers: floored,
    });
  }

  const stockGross = absSum(stocks);
  const directGross = absSum(directEtfs);
  return {
    beta: {
      stock_beta_usd: round(stockBeta),
      direct_etf_beta_usd: round(directBeta),
      total_beta_usd: round(stockBeta + directBeta),
      total_beta_pct_of_gross: gross > 0 ? round((stockBeta + directBeta) / gross, 4) : null,
      by_sector_usd: roundMap(betaBySector),
      direct_etf_betas: directBetas,
      note: "Stock betas are ERM3 L1 market betas; direct ETF betas are measured against SPY over the covariance window (SPY = 1).",
    },
    hedges,
    risk,
    coverage: {
      input_gross_usd: round(gross),
      modelled_stock_gross_usd: round(stockGross),
      direct_etf_gross_usd: round(directGross),
      by_calculation: {
        beta: share(betaCovered + directBetaCovered),
        hedge_l1: share(hedgeCovered.l1),
        hedge_l2: share(hedgeCovered.l2),
        hedge_l3: share(hedgeCovered.l3),
        hedge_lstar: share(lstarCovered),
        residual: share(residualCovered),
        systematic: share(systematicCovered),
        total_risk: share(totalRiskCovered),
      },
      etfs_without_covariance: [...uncoveredEtfs].sort(),
      excluded_from_lstar: lstarExcluded,
      residual_flagged: residualFlagged,
    },
    warnings,
  };
}
