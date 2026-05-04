/**
 * Geometric cumulative-return + waterfall attribution math, ported from the
 * Python SDK's `stock_deep_dive._make_dd_cum_chart` and
 * `p1_stock_performance._make_cum_waterfall`.
 *
 * The fund tearsheet's I. Cumulative Returns chart consumes both outputs:
 * the line panel plots each layer's compounded path, the waterfall summarizes
 * the endpoints into incremental layer contributions that sum to gross.
 */

import type { FundNavRow, FundPortfolioRow } from "@/lib/dal/funds-zarr-reader";

export interface CumulativeSeries {
  /** ISO month-end labels matching the source rows, length = rows.length. */
  teos: string[];
  /** L1 (market) cumulative path: ∏(1 + r_market[t]) − 1. */
  l1_market: number[];
  /** L2 (market + sector) cumulative path: ∏(1 + r_mkt + r_sec) − 1. */
  l2_sector: number[];
  /** L3 (market + sector + subsector) cumulative path. */
  l3_subsector: number[];
  /** Idiosyncratic-only cumulative path (stand-alone residual line). */
  residual: number[];
  /** Gross-fund cumulative path from the actual 13F-derived holdings return. */
  gross: number[];
  /** Realized NAV cumulative path from yfinance. Empty when navHistory is null. */
  nav: number[];
}

/**
 * Compute geometric cumulative returns for each layer + the realized NAV path.
 *
 * `portfolioHistory` and `navHistory` may have different teo coverage. We
 * align them by intersecting on teo and dropping rows that don't appear in
 * both — without alignment the line endpoints would be misleading
 * ("which series ended where?"). Returns an empty series object when there
 * are zero overlapping teos.
 *
 * Per row:
 *   r_l1[t] = portfolio_market_return
 *   r_l2[t] = r_l1 + portfolio_sector_return
 *   r_l3[t] = r_l2 + portfolio_subsector_return
 *   r_residual[t] = portfolio_idiosyncratic_return
 *   r_gross[t] = portfolio_gross_return
 *   r_nav[t] = nav_return_monthly  (when present)
 *
 * Cumulative path: cum[t] = ∏_{i ≤ t}(1 + r[i]) − 1.
 */
export function computeCumulativeSeries(
  portfolioHistory: FundPortfolioRow[],
  navHistory: FundNavRow[],
): CumulativeSeries {
  const empty: CumulativeSeries = {
    teos: [],
    l1_market: [],
    l2_sector: [],
    l3_subsector: [],
    residual: [],
    gross: [],
    nav: [],
  };
  if (portfolioHistory.length === 0) return empty;

  const navByTeo = new Map<string, number>();
  for (const r of navHistory) {
    if (r.nav_return_monthly != null) {
      navByTeo.set(r.teo, r.nav_return_monthly);
    }
  }

  const teos: string[] = [];
  const l1_step: number[] = [];
  const l2_step: number[] = [];
  const l3_step: number[] = [];
  const res_step: number[] = [];
  const gross_step: number[] = [];
  const nav_step: number[] = [];
  const hasNav = navByTeo.size > 0;

  for (const row of portfolioHistory) {
    if (hasNav && !navByTeo.has(row.teo)) continue;

    const r_mkt = row.portfolio_market_return ?? 0;
    const r_sec = row.portfolio_sector_return ?? 0;
    const r_sub = row.portfolio_subsector_return ?? 0;
    const r_idio = row.portfolio_idiosyncratic_return ?? 0;
    const r_gross = row.portfolio_gross_return ?? 0;

    teos.push(row.teo);
    l1_step.push(r_mkt);
    l2_step.push(r_mkt + r_sec);
    l3_step.push(r_mkt + r_sec + r_sub);
    res_step.push(r_idio);
    gross_step.push(r_gross);
    if (hasNav) nav_step.push(navByTeo.get(row.teo) ?? 0);
  }

  if (teos.length === 0) return empty;

  return {
    teos,
    l1_market: compoundCumulative(l1_step),
    l2_sector: compoundCumulative(l2_step),
    l3_subsector: compoundCumulative(l3_step),
    residual: compoundCumulative(res_step),
    gross: compoundCumulative(gross_step),
    nav: hasNav ? compoundCumulative(nav_step) : [],
  };
}

/**
 * Geometric compounding of monthly steps into cumulative returns:
 *   cum[t] = ∏_{i ≤ t}(1 + r[i]) − 1.
 */
export function compoundCumulative(stepReturns: number[]): number[] {
  const out = new Array<number>(stepReturns.length);
  let acc = 1;
  for (let i = 0; i < stepReturns.length; i++) {
    acc *= 1 + stepReturns[i]!;
    out[i] = acc - 1;
  }
  return out;
}

export interface AttributionWaterfall {
  /** L1 endpoint = SPY-style market cumulative return at the last teo. */
  l1_market: number;
  /** L2 incremental contribution = L2_endpoint − L1_endpoint. */
  l2_sector: number;
  /** L3 incremental contribution = L3_endpoint − L2_endpoint. */
  l3_subsector: number;
  /** Residual contribution = gross_endpoint − L3_endpoint (the alpha sliver). */
  residual: number;
  /** Sum of the four layer contributions. */
  gross: number;
  /**
   * Realized-NAV endpoint, when present. Plotted as a separate marker on the
   * waterfall — does NOT roll into the four-bar attribution. The gap between
   * `nav` and `gross` is the institutional-grade "13F-vs-realised" insight.
   */
  nav: number | null;
}

/**
 * Build the right-panel waterfall endpoints from a cumulative series. Each
 * incremental contribution is the geometric-attribution delta of one layer
 * over the prior. With the L3 identity:
 *   gross = L1 + (L2 − L1) + (L3 − L2) + (gross − L3)
 *         = market + sector_tilt + subsector_tilt + residual.
 */
export function buildWaterfall(series: CumulativeSeries): AttributionWaterfall {
  if (series.teos.length === 0) {
    return {
      l1_market: 0,
      l2_sector: 0,
      l3_subsector: 0,
      residual: 0,
      gross: 0,
      nav: null,
    };
  }
  const last = series.teos.length - 1;
  const l1 = series.l1_market[last]!;
  const l2 = series.l2_sector[last]!;
  const l3 = series.l3_subsector[last]!;
  const gross = series.gross[last]!;
  const nav = series.nav.length > 0 ? series.nav[last]! : null;
  return {
    l1_market: l1,
    l2_sector: l2 - l1,
    l3_subsector: l3 - l2,
    residual: gross - l3,
    gross,
    nav,
  };
}
