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
 *   market beta, risk basis    = xᵀ Σ e_SPY / σ²_SPY    (beta.risk_basis; beta.total_beta_usd stays L1)
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

/**
 * Residual share above this: listed in `risk.residual.hedge_added_variance` and
 * warned as `hedge_added_variance`. Owner decision (Conrad, 2026-10-15,
 * RMAPI-15): warn only above 1.02, a 0.02 tolerance above 1.0, so shares a hair
 * over 1 (60 names between 1.0001 and 1.042 on the reviewed book) do not raise
 * the warning. Values stay uncapped and still sum to one; only the warning
 * threshold changes. Mirrored in sdk/riskmodels/exposure_history.py.
 */
export const HEDGE_ADDED_VARIANCE_WARN_THRESHOLD = 1.02;
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
  /** Length of risk.residual.top_contributors (default 15); "all" lists every name. */
  topContributors?: number | "all";
  /** Add per-name rows to scenario_inputs.positions (off by default: books go to 1000 names). */
  includePositions?: boolean;
}

export const DEFAULT_TOP_CONTRIBUTORS = 15;

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

const EXCLUSION_DETAIL: Record<ExclusionReason, string> = {
  no_lstar: "No L* level for this name (too little history), so it is left out of hedges and risk under hedge_level lstar.",
  lstar_level_incomplete: "The name's L* level is missing a hedge leg or residual share, so it is left out under hedge_level lstar. A fixed hedge_level (l1, l2 or l3) may include it.",
};

/** First date ERM3 L* levels are served (lib/dal/served-history.ts, product "lstar"). */
export const LSTAR_SERVED_FROM = "2013-01-01";

/**
 * The level a name is hedged and measured at. Under "lstar" that is its own
 * `lstar_level`. A name with no L* value falls back to L3 when its L3 hedge
 * legs and residual share are present: L* is served from 2013-01-01, while L3
 * is served from 2011-12-07, so as_of dates in between (and any name whose L*
 * alone is missing) use L3 and are reported (`lstar_unavailable_l3_fallback`).
 * A name with neither has too little history (every level uses the same
 * estimation window; checked 2026-10-08: 350 of 350 names without L* had no
 * L1 data) and is excluded and reported.
 */
export function resolveLevel(
  s: StockInput,
  basis: Basis,
): { level: Level | null; reason: ExclusionReason | null; l3Fallback?: true } {
  if (basis !== "lstar") return { level: basis, reason: null };
  const ls = s.metrics.lstar_level;
  if (!finite(ls) || ls < 1 || ls > 3) {
    return levelUsable(s, "l3") ? { level: "l3", reason: null, l3Fallback: true } : { level: null, reason: "no_lstar" };
  }
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
  const lstarExcluded: Array<{ ticker: string; value_usd: number; reason: ExclusionReason; detail: string }> = [];
  const l3Fallback: string[] = [];
  for (const s of stocks) {
    const { level, reason, l3Fallback: fellBack } = resolveLevel(s, basis);
    if (fellBack) l3Fallback.push(...s.tickers);
    if (level) {
      levelOf.set(s.symbol, level);
      levelCounts[level] += 1;
    }
    if (reason) {
      lstarExcluded.push({ ticker: s.tickers[0] ?? s.symbol, value_usd: round(s.value), reason, detail: EXCLUSION_DETAIL[reason] });
    }
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
    if (res > HEDGE_ADDED_VARIANCE_WARN_THRESHOLD) hedgeAddedVariance.push({ ticker: label, level, residual_share: round(res, 4) });
    if (res > RES_ER_EXTREME) extreme.push(label);
    const v = s.value * s.value * sv * Math.max(res, 0);
    residVar += v;
    residualCovered += Math.abs(s.value);
    residOk.add(s.symbol);
    residByName.push({ ticker: label, value: s.value, var: v });
  }

  let riskBasisBeta: {
    basis: Basis;
    beta_usd: number;
    beta_pct_of_gross: number | null;
    by_layer_usd: Record<string, number>;
    gross_covered: number | null;
  } | null = null;

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

    // Market beta on the risk basis: x' Σ e_SPY / σ²_SPY, the SPY-equivalent
    // dollars of the same exposure vector the risk split uses.
    const varSpy = spyIdx !== undefined ? cov.S[spyIdx]![spyIdx]! : 0;
    if (spyIdx !== undefined && varSpy > 0) {
      const betaOf = (v: number[]) => v.reduce((a, vi, i) => a + vi * cov.S[i]![spyIdx]!, 0) / varSpy;
      const betaUsd = betaOf(x);
      riskBasisBeta = {
        basis,
        beta_usd: round(betaUsd),
        beta_pct_of_gross: gross > 0 ? round(betaUsd / gross, 4) : null,
        by_layer_usd: Object.fromEntries(
          (Object.keys(xLayer) as Array<keyof typeof xLayer>).map((layer) => [layer, round(betaOf(xLayer[layer]))]),
        ),
        gross_covered: null as number | null,
      };
    }
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
          .slice(0, input.topContributors === "all" ? undefined : (input.topContributors ?? DEFAULT_TOP_CONTRIBUTORS))
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

  if (riskBasisBeta) riskBasisBeta.gross_covered = share(systematicCovered);

  // ---- 4. scenario inputs ----------------------------------------------------------
  const spyVar = cov && spyIdx !== undefined ? cov.S[spyIdx]![spyIdx]! : 0;
  const hedgeLegEtfs = new Set<string>();
  for (const s of stocks) {
    const level = levelOf.get(s.symbol);
    const legs = level ? stockLegs(s, level) : null;
    for (const [etf] of legs ?? []) hedgeLegEtfs.add(etf);
  }
  const etfRows = new Map<string, { ticker: string; beta_to_spy: number | null; annual_vol: number | null; held_usd: number; hedge_leg: boolean; in_covariance: boolean }>();
  for (const etf of [...(cov?.etfs ?? []), ...directEtfs.map((d) => d.ticker), ...hedgeLegEtfs]) {
    if (etfRows.has(etf)) continue;
    const i = covIdx.get(etf);
    const inCov = i !== undefined && !!cov;
    etfRows.set(etf, {
      ticker: etf,
      beta_to_spy: inCov && spyVar > 0 ? round(cov!.S[i]![spyIdx!]! / spyVar, 4) : null,
      annual_vol: inCov ? round(Math.sqrt(Math.max(cov!.S[i]![i]!, 0) * TRADING_DAYS), 4) : null,
      held_usd: round(directExposure[etf] ?? 0),
      hedge_leg: hedgeLegEtfs.has(etf),
      in_covariance: inCov,
    });
  }
  const scenarioInputs: Record<string, unknown> = {
    covariance_start: cov?.start ?? null,
    covariance_end: cov?.end ?? null,
    covariance_effective_n: cov?.effective_n ?? 0,
    etfs: [...etfRows.values()],
    positions_included: input.includePositions === true,
    note: "beta_to_spy = cov(ETF, SPY) / var(SPY) and annual_vol = √(252·var) over the covariance window (SPY = 1). held_usd is the book's own position; hedge_leg marks ETFs used by a name's hedge at its level. Per-name rows (scenario_inputs.positions) are returned only when include_positions is true.",
  };
  if (input.includePositions) {
    scenarioInputs.positions = stocks.map((s) => {
      const level = levelOf.get(s.symbol) ?? null;
      const legs = level ? stockLegs(s, level) : null;
      const res = level ? s.metrics[resKey(level)] : null;
      const sv = s.metrics.stock_var;
      const resVol = finite(sv) && sv >= 0 && finite(res) ? Math.sqrt(sv * Math.max(res, 0) * TRADING_DAYS) : null;
      const excluded = lstarExcluded.find((e) => e.ticker === (s.tickers[0] ?? s.symbol));
      return {
        ticker: s.tickers[0] ?? s.symbol,
        tickers: s.tickers,
        value_usd: round(s.value),
        sector_etf: s.sector_etf,
        subsector_etf: s.subsector_etf,
        level,
        excluded_reason: excluded?.reason ?? null,
        l1_beta: finite(s.metrics.l1_mkt_beta) ? round(s.metrics.l1_mkt_beta, 4) : null,
        hedge_ratios: legs ? Object.fromEntries(legs.map(([etf, , hr]) => [etf, round(hr, 4)])) : null,
        residual_share: finite(res) ? round(res, 4) : null,
        residual_vol_annual: resVol === null ? null : round(resVol, 4),
        residual_vol_annual_usd: resVol === null ? null : round(Math.abs(s.value) * resVol),
      };
    });
  }

  const warnings: ExposureWarning[] = [];
  if (l3Fallback.length) {
    const n = l3Fallback.length;
    warnings.push({
      code: "lstar_unavailable_l3_fallback",
      message: `L* hedge levels are published from ${LSTAR_SERVED_FROM}. ${n} ${n === 1 ? "name has" : "names have"} no L* level at this date and ${n === 1 ? "uses" : "use"} L3 instead (counted under l3 in names_by_level).`,
      tickers: l3Fallback,
    });
  }
  if (hedgeAddedVariance.length) {
    warnings.push({
      code: "hedge_added_variance",
      message: `For these names the model's hedge at their level added variance over the window (residual share above ${HEDGE_ADDED_VARIANCE_WARN_THRESHOLD}). Their residual risk is larger than their unhedged variance and is used as is.`,
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
      method: "l1_market_beta",
      note: "stock_beta_usd and total_beta_usd use each stock's ERM3 L1 market beta, whatever hedge_level is; direct ETF betas are measured against SPY over the covariance window (SPY = 1). risk_basis is the market beta of the exposure vector the risk split uses (hedge_level and the ETF covariance): xᵀΣe_SPY / σ²_SPY. The two differ when a name's L2/L3 sector and subsector legs carry market beta of their own.",
      risk_basis: riskBasisBeta
        ? {
            ...riskBasisBeta,
            method: "exposure_covariance_beta",
            note: "Σ_e x_e·cov(e, SPY)/var(SPY), x = the book's raw-ETF exposure at hedge_level (minus the stock hedge legs, plus ETFs held). by_layer_usd splits it by market, sector, subsector and direct_etf legs; gross_covered is the share of submitted gross in x (same as coverage.by_calculation.systematic). Null when no covariance with SPY could be built.",
          }
        : null,
    },
    hedges,
    risk,
    scenario_inputs: scenarioInputs,
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
