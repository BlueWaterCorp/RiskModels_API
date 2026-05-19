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
