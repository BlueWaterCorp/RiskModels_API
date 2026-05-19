/**
 * Economic recommendation layer on top of Lstar.
 *
 * Mirrors `erm3.shared.hedge_recommendation` in the ERM3 repo. The Python file
 * is the source of truth; if behavior diverges, the Python wins and this file
 * must be updated. Run the parallel test suite to detect drift —
 * `tests/hedge-recommendation.test.ts` ports each Python case.
 *
 * Lstar answers "which cascade level is STATISTICALLY warranted by the data?"
 * `recommendHedgeLevel` answers "which level should the trader ACTUALLY execute?"
 * — applies an OOS-haircut on the in-sample marginal ERs plus a hedge-gross
 * leverage cap that varies by user segment. Lstar itself is never mutated;
 * divergence between the two fields is the regime-change alert the chat
 * surfaces.
 *
 * Until Phase B2's walk-forward backtest lands, the 0.7 haircut is a
 * literature-grounded placeholder for typical sector/subsector-ETF tracking
 * error + borrow-cost drag on realized OOS variance reduction.
 *
 * @see RiskModels_API/docs/plans/hedge-recommendation-ts-port.md
 * @see ~/BW_Code/ERM3/erm3/shared/hedge_recommendation.py
 */

export type LStar = "L1" | "L2" | "L3";
export type LStarOrNone = LStar | null;
export type UserSegment = "retail" | "family_office" | "ls_equity" | "stat_arb";

/**
 * Hedge-gross caps (Σ|HR_leg| over hedge legs, excluding the +1 stock position).
 *
 * - retail: Reg-T 50% margin → ~2× total gross max → 1.5× on hedge side.
 * - family_office: 2× gross book is industry-standard for RIA mandates.
 * - ls_equity: 3–4× gross is normal; 3.0 is the conservative single-name cap.
 * - stat_arb: 5× single-name is fine; aggregate book is the binding constraint.
 */
export const SEGMENT_LEVERAGE_CAPS: Record<UserSegment, number> = {
  retail:        1.5,
  family_office: 2.0,
  ls_equity:     3.0,
  stat_arb:      5.0,
};

export const DEFAULT_USER_SEGMENT: UserSegment = "family_office";

/**
 * In-sample ER haircut for the OOS variance-reduction estimate. Until Phase B2
 * replaces this with a measured factor, 0.7 is a literature-grounded
 * placeholder (typical ETF tracking error + borrow-cost drag).
 */
export const DEFAULT_ER_HAIRCUT = 0.7;

/**
 * Minimum HAIRCUT marginal ER required to justify adding a cascade level.
 * 1.0% haircut ER ≈ 1.43% raw ER — slightly stricter than LStar's 1% raw gate,
 * so the economic gate can bite even when LStar passes.
 */
export const DEFAULT_MIN_HAIRCUT_ER = 0.01;

export interface RecommendHedgeLevelInputs {
  lstar: LStarOrNone | string;       // accept stringly-typed inputs from the zarr
  l1HedgeGross: number;
  l2HedgeGross: number;
  l3HedgeGross: number;
  l2SectorEr: number;
  l3SubsectorEr: number;
  userSegment?: UserSegment;
  leverageCap?: number;              // explicit override of segment default
  erHaircut?: number;                // defaults to DEFAULT_ER_HAIRCUT
  minHaircutMarginalEr?: number;     // defaults to DEFAULT_MIN_HAIRCUT_ER
}

/**
 * Pick the simplest cascade level whose economics clear two gates.
 *
 * Top-down from Lstar's statistical pick, drop one level at a time if EITHER:
 *  (a) hedge_gross at that level exceeds the user's leverage cap, OR
 *  (b) the haircut marginal ER added by that level falls below the floor.
 *
 * Never drops below L1 — the market hedge is always available regardless of
 * economics. (If the user wants no hedge at all that's a decision outside
 * this function.)
 *
 * Always returns a concrete level — never null.
 */
export function recommendHedgeLevel(inp: RecommendHedgeLevelInputs): LStar {
  const {
    lstar,
    l1HedgeGross,
    l2HedgeGross,
    l3HedgeGross,
    l2SectorEr,
    l3SubsectorEr,
    userSegment = DEFAULT_USER_SEGMENT,
    leverageCap,
    erHaircut = DEFAULT_ER_HAIRCUT,
    minHaircutMarginalEr = DEFAULT_MIN_HAIRCUT_ER,
  } = inp;

  // Reference `l1HedgeGross` so linters don't flag it as unused — it's part
  // of the contract and useful for callers that want to log / cache the full
  // gross profile alongside the recommendation.
  void l1HedgeGross;

  if (lstar !== "L1" && lstar !== "L2" && lstar !== "L3") {
    return "L1";
  }

  const cap =
    leverageCap ??
    SEGMENT_LEVERAGE_CAPS[userSegment] ??
    SEGMENT_LEVERAGE_CAPS[DEFAULT_USER_SEGMENT];

  let candidate: LStar = lstar;

  // Step down L3 → L2 if subsector layer fails either economic gate.
  if (candidate === "L3") {
    const marginalHaircut = (l3SubsectorEr || 0) * erHaircut;
    const leverageFails = l3HedgeGross > cap;
    const erFails = marginalHaircut < minHaircutMarginalEr;
    if (leverageFails || erFails) {
      candidate = "L2";
    }
  }

  // Step down L2 → L1 if sector layer fails either economic gate.
  if (candidate === "L2") {
    const marginalHaircut = (l2SectorEr || 0) * erHaircut;
    const leverageFails = l2HedgeGross > cap;
    const erFails = marginalHaircut < minHaircutMarginalEr;
    if (leverageFails || erFails) {
      candidate = "L1";
    }
  }

  return candidate;
}

/**
 * Σ |HR_leg| over the supplied hedge legs (exclude the +1 stock).
 *
 * NaN-safe: NaN/null/undefined inputs are skipped, not summed.
 *
 * @example
 *   hedgeGrossFromHrs(L1_market_HR)                                    // L1
 *   hedgeGrossFromHrs(L2_market_HR, L2_sector_HR)                       // L2
 *   hedgeGrossFromHrs(L3_market_HR, L3_sector_HR, L3_subsector_HR)      // L3
 */
export function hedgeGrossFromHrs(
  ...hrs: Array<number | null | undefined>
): number {
  return hrs.reduce<number>((acc, h) => {
    if (h == null || Number.isNaN(h)) return acc;
    return acc + Math.abs(h);
  }, 0);
}
