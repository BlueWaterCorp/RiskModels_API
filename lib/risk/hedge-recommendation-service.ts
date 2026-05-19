/**
 * Hedge-recommendation snapshot — orchestrates the statistical Lstar pick
 * (from `lstar-service`) with the economic recommendation rule (from
 * `lib/dal/hedge-recommendation`) into the 6 fields the metrics endpoint
 * and the upcoming /api/hedge-basket endpoint surface.
 *
 * Pure snapshot — no IO. Caller passes in already-fetched per-teo metrics.
 *
 * @see docs/plans/hedge-recommendation-ts-port.md
 * @see ~/BW_Code/ERM3/erm3/shared/hedge_recommendation.py (SSOT)
 */

import {
  DEFAULT_ER_HAIRCUT,
  DEFAULT_MIN_HAIRCUT_ER,
  DEFAULT_USER_SEGMENT,
  SEGMENT_LEVERAGE_CAPS,
  hedgeGrossFromHrs,
  recommendHedgeLevel,
  type LStar,
  type UserSegment,
} from "@/lib/dal/hedge-recommendation";
import { LSTAR_DEFAULT_THRESHOLD, pickLstar, type LstarLevel } from "./lstar-service";

export const VALID_USER_SEGMENTS = Object.keys(SEGMENT_LEVERAGE_CAPS) as UserSegment[];

export function isValidUserSegment(v: string | null | undefined): v is UserSegment {
  return typeof v === "string" && (VALID_USER_SEGMENTS as string[]).includes(v);
}

export interface HedgeRecommendationSnapshotInputs {
  l1_mkt_hr: number | null;
  l2_mkt_hr: number | null;
  l2_sec_hr: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
  l2_sec_er: number | null;
  l3_sub_er: number | null;
  /** Segment-driven leverage cap; defaults to "family_office" (2.0×). */
  user_segment?: UserSegment;
  /** Lstar marginal-ER threshold; defaults to 0.01 (1%). */
  threshold?: number;
}

export interface HedgeRecommendationSnapshot {
  /** Statistical pick (1% marginal-ER rule on raw ERs). Null when both ERs missing. */
  lstar: LstarLevel | null;
  /** Economic pick after leverage cap + haircut floor. Always concrete. */
  recommended_hedge_level: LStar;
  /** Echo of the segment that drove the recommendation. */
  user_segment_applied: UserSegment;
  /** Σ |HR_leg| ex-stock at each cascade level. NaN-safe (missing HRs treated as 0). */
  l1_hedge_gross: number;
  l2_hedge_gross: number;
  l3_hedge_gross: number;
  /**
   * (l2_sec_er + l3_sub_er) × 0.7 — combined OOS estimate of the sector + subsector
   * variance contribution. Placeholder haircut until Phase B2 walk-forward.
   */
  higher_er_haircut: number;
  /** Leverage cap applied (echoed for transparency in the API payload). */
  leverage_cap_applied: number;
}

/**
 * Compose the snapshot from latest-teo metric scalars.
 *
 * Diverges from Lstar (`snapshot.lstar !== snapshot.recommended_hedge_level`)
 * when the economic gate downgrades the statistical pick — this is the
 * regime-change alert the chat surfaces.
 */
export function computeHedgeRecommendationSnapshot(
  inp: HedgeRecommendationSnapshotInputs,
): HedgeRecommendationSnapshot {
  const userSegment: UserSegment = inp.user_segment ?? DEFAULT_USER_SEGMENT;
  const threshold = inp.threshold ?? LSTAR_DEFAULT_THRESHOLD;

  const lstar = pickLstar(inp.l2_sec_er ?? null, inp.l3_sub_er ?? null, threshold);

  const l1HedgeGross = hedgeGrossFromHrs(inp.l1_mkt_hr);
  const l2HedgeGross = hedgeGrossFromHrs(inp.l2_mkt_hr, inp.l2_sec_hr);
  const l3HedgeGross = hedgeGrossFromHrs(inp.l3_mkt_hr, inp.l3_sec_hr, inp.l3_sub_hr);

  const recommended = recommendHedgeLevel({
    lstar,
    l1HedgeGross,
    l2HedgeGross,
    l3HedgeGross,
    l2SectorEr: inp.l2_sec_er ?? 0,
    l3SubsectorEr: inp.l3_sub_er ?? 0,
    userSegment,
  });

  // NaN-safe sum of the two higher-layer raw ERs, then haircut.
  const l2 = inp.l2_sec_er ?? 0;
  const l3 = inp.l3_sub_er ?? 0;
  const higherErHaircut = (Number.isFinite(l2) ? l2 : 0) + (Number.isFinite(l3) ? l3 : 0);

  return {
    lstar,
    recommended_hedge_level: recommended,
    user_segment_applied: userSegment,
    l1_hedge_gross: l1HedgeGross,
    l2_hedge_gross: l2HedgeGross,
    l3_hedge_gross: l3HedgeGross,
    higher_er_haircut: higherErHaircut * DEFAULT_ER_HAIRCUT,
    leverage_cap_applied: SEGMENT_LEVERAGE_CAPS[userSegment],
  };
}

/**
 * Per-leg row in the hedge basket — what the chat renders.
 *
 *   leg                     — display label (ticker, "AAPL" / "SPY" / "XLK" / etc.)
 *   side                    — "long" | "short" (derived from sign of `position`)
 *   position                — signed HR (the +1 stock leg is +1.0; hedges are -HR)
 *   beta_to_spy             — leg's univariate slope on SPY (the market root)
 *   market_beta_contribution — position × beta_to_spy (sums to net market β)
 */
export interface HedgeBasketLeg {
  leg: string;
  side: "long" | "short";
  position: number;
  beta_to_spy: number;
  market_beta_contribution: number;
}

/**
 * Structured hedge-basket payload for `/api/hedge-basket/{ticker}` — what the
 * chat renders as a 4-row table with a net-market-β subtotal.
 *
 * `decision_trace` is the human-readable explanation of how recommended_hedge_level
 * was derived; the chat narrates it verbatim. Net market β residual is FYI per
 * methodology task #22 (the cascade zeros orth factor exposure, not raw market).
 */
export interface HedgeBasket {
  ticker: string;
  as_of: string | null;
  lstar: LstarLevel | null;
  recommended_hedge_level: LStar;
  user_segment_applied: UserSegment;
  leverage_cap_applied: number;
  haircut_applied: number;
  legs: HedgeBasketLeg[];
  net_market_beta_after_hedge: number;
  hedge_gross: { L1: number; L2: number; L3: number };
  marginal_er: {
    L2_sector_raw: number | null;
    L2_sector_haircut: number;
    L3_subsector_raw: number | null;
    L3_subsector_haircut: number;
  };
  decision_trace: string[];
}

export interface BuildHedgeBasketInputs extends HedgeRecommendationSnapshotInputs {
  ticker: string;
  as_of: string | null;
  /** Stock's L1 market β. β_m = -L1_market_HR by convention. */
  beta_m_aapl: number | null;
  sector_etf_ticker: string | null;
  subsector_etf_ticker: string | null;
  market_etf_ticker?: string;       // defaults to "SPY"
  /** Sector ETF's slope on SPY (λ_s→m). 1.0 when the sector ETF IS SPY. */
  lambda_s_to_m: number | null;
  /** Subsector ETF's slope on SPY (λ_u→m). 1.0 when the subsector ETF IS SPY. */
  lambda_u_to_m: number | null;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

/**
 * Compose the basket payload from already-fetched inputs.
 *
 * Pure function — no IO. Caller is responsible for resolving link-betas from
 * the link-betas zarr (`readLatestLinkBetas` in zarr-reader.ts) before calling
 * this. SPY-as-sector / SPY-as-subsector edge cases use λ=1.0 by convention.
 */
export function buildHedgeBasket(inp: BuildHedgeBasketInputs): HedgeBasket {
  const snap = computeHedgeRecommendationSnapshot(inp);
  const marketEtf = inp.market_etf_ticker ?? "SPY";

  // Conventions for SPY-rooted legs.
  const sectorIsSpy = inp.sector_etf_ticker?.toUpperCase() === marketEtf.toUpperCase();
  const subsectorIsSpy = inp.subsector_etf_ticker?.toUpperCase() === marketEtf.toUpperCase();
  const lambdaSM = sectorIsSpy ? 1.0 : (inp.lambda_s_to_m ?? 0);
  const lambdaUM = subsectorIsSpy ? 1.0 : (inp.lambda_u_to_m ?? 0);

  const betaMAapl = inp.beta_m_aapl ?? 0;
  const hrM = inp.l3_mkt_hr ?? 0;
  const hrS = inp.l3_sec_hr ?? 0;
  const hrU = inp.l3_sub_hr ?? 0;

  const legs: HedgeBasketLeg[] = [
    {
      leg: inp.ticker.toUpperCase(),
      side: "long",
      position: 1.0,
      beta_to_spy: betaMAapl,
      market_beta_contribution: 1.0 * betaMAapl,
    },
    {
      leg: marketEtf,
      side: hrM <= 0 ? "short" : "long",
      position: hrM,
      beta_to_spy: 1.0,
      market_beta_contribution: hrM * 1.0,
    },
  ];
  if (inp.sector_etf_ticker && !sectorIsSpy) {
    legs.push({
      leg: inp.sector_etf_ticker.toUpperCase(),
      side: hrS <= 0 ? "short" : "long",
      position: hrS,
      beta_to_spy: lambdaSM,
      market_beta_contribution: hrS * lambdaSM,
    });
  }
  if (inp.subsector_etf_ticker && !subsectorIsSpy) {
    legs.push({
      leg: inp.subsector_etf_ticker.toUpperCase(),
      side: hrU <= 0 ? "short" : "long",
      position: hrU,
      beta_to_spy: lambdaUM,
      market_beta_contribution: hrU * lambdaUM,
    });
  }

  const netMarketBetaAfterHedge = legs.reduce((acc, l) => acc + l.market_beta_contribution, 0);

  // Decision-trace narration. Mirrors the recommendHedgeLevel decision logic
  // so the user can see WHY recommended_hedge_level may diverge from lstar.
  const trace: string[] = [];
  const threshold = inp.threshold ?? LSTAR_DEFAULT_THRESHOLD;
  const lstar = snap.lstar;
  const subRawNn = inp.l3_sub_er ?? null;
  const secRawNn = inp.l2_sec_er ?? null;
  if (lstar === null) {
    trace.push(
      `Lstar=null (both L2 and L3 marginal ER unavailable — pre-IPO / delisted / masked); recommendation defaults to L1.`,
    );
  } else if (lstar === "L3") {
    trace.push(
      `Lstar=L3 (subsector marginal ER ${fmtPct(subRawNn ?? 0)} ≥ ${fmtPct(threshold)} threshold)`,
    );
  } else if (lstar === "L2") {
    trace.push(
      `Lstar=L2 (sector marginal ER ${fmtPct(secRawNn ?? 0)} ≥ ${fmtPct(threshold)} threshold; subsector ${fmtPct(subRawNn ?? 0)} fails)`,
    );
  } else {
    trace.push(`Lstar=L1 (sector ${fmtPct(secRawNn ?? 0)} and subsector ${fmtPct(subRawNn ?? 0)} both fail ${fmtPct(threshold)} threshold)`);
  }

  const cap = snap.leverage_cap_applied;
  const erHaircut = DEFAULT_ER_HAIRCUT;
  const minHaircut = DEFAULT_MIN_HAIRCUT_ER;
  // Walk the candidate ladder mirroring recommendHedgeLevel's logic.
  let candidate: LStar = (lstar ?? "L1") as LStar;
  if (candidate === "L3") {
    const haircut = (subRawNn ?? 0) * erHaircut;
    if (snap.l3_hedge_gross > cap) {
      trace.push(
        `L3 hedge gross ${snap.l3_hedge_gross.toFixed(2)} > ${cap.toFixed(1)}× cap (${snap.user_segment_applied}) → drop to L2`,
      );
      candidate = "L2";
    } else if (haircut < minHaircut) {
      trace.push(
        `L3 subsector haircut ER ${fmtPct(haircut)} < ${fmtPct(minHaircut)} floor → drop to L2`,
      );
      candidate = "L2";
    }
  }
  if (candidate === "L2") {
    const haircut = (secRawNn ?? 0) * erHaircut;
    if (snap.l2_hedge_gross > cap) {
      trace.push(
        `L2 hedge gross ${snap.l2_hedge_gross.toFixed(2)} > ${cap.toFixed(1)}× cap → drop to L1`,
      );
      candidate = "L1";
    } else if (haircut < minHaircut) {
      trace.push(
        `L2 sector haircut ER ${fmtPct(haircut)} < ${fmtPct(minHaircut)} floor → drop to L1`,
      );
      candidate = "L1";
    }
  }
  trace.push(`Final: ${snap.recommended_hedge_level}`);

  return {
    ticker: inp.ticker.toUpperCase(),
    as_of: inp.as_of,
    lstar: snap.lstar,
    recommended_hedge_level: snap.recommended_hedge_level,
    user_segment_applied: snap.user_segment_applied,
    leverage_cap_applied: snap.leverage_cap_applied,
    haircut_applied: erHaircut,
    legs,
    net_market_beta_after_hedge: netMarketBetaAfterHedge,
    hedge_gross: {
      L1: snap.l1_hedge_gross,
      L2: snap.l2_hedge_gross,
      L3: snap.l3_hedge_gross,
    },
    marginal_er: {
      L2_sector_raw: secRawNn,
      L2_sector_haircut: (secRawNn ?? 0) * erHaircut,
      L3_subsector_raw: subRawNn,
      L3_subsector_haircut: (subRawNn ?? 0) * erHaircut,
    },
    decision_trace: trace,
  };
}
