/**
 * Hedge-recommendation snapshot — orchestrates the statistical Lstar pick
 * (from `lstar-service`) with the economic recommendation rule (from
 * `lib/dal/hedge-recommendation`) into the fields the metrics endpoint and
 * /api/hedge-basket surface.
 *
 * Pure snapshot — no IO. Caller passes in already-fetched per-teo metrics.
 *
 * Also composes the /api/hedge-basket payload (`buildHedgeBasket`).
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
import { LSTAR_DEFAULT_THRESHOLD, selectLstar, type LstarLevel } from "./lstar-service";

export const VALID_USER_SEGMENTS = Object.keys(SEGMENT_LEVERAGE_CAPS) as UserSegment[];

export function isValidUserSegment(v: string | null | undefined): v is UserSegment {
  return typeof v === "string" && (VALID_USER_SEGMENTS as string[]).includes(v);
}

export interface HedgeRecommendationSnapshotInputs {
  /** Engine GBM/legacy materialized choice; null/0 means no recommendation. */
  lstar_level?: number | null;
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
  /** Canonical engine pick; legacy threshold only for explicit overrides or absent columns. */
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
  /**
   * Levels whose hedge ratios or marginal ER are missing. Such a level is never
   * recommended: selection starts at the highest complete level at or below
   * Lstar, so a missing value can neither pass nor fail a gate.
   */
  incomplete_levels: LStar[];
}

const finiteNum = (x: number | null | undefined): x is number =>
  x != null && Number.isFinite(x);

/** Levels whose inputs (every hedge ratio, plus the marginal ER gating it) are missing. */
export function incompleteHedgeLevels(inp: HedgeRecommendationSnapshotInputs): LStar[] {
  const out: LStar[] = [];
  if (!finiteNum(inp.l1_mkt_hr)) out.push("L1");
  if (!(finiteNum(inp.l2_mkt_hr) && finiteNum(inp.l2_sec_hr) && finiteNum(inp.l2_sec_er))) out.push("L2");
  if (
    !(finiteNum(inp.l3_mkt_hr) && finiteNum(inp.l3_sec_hr) && finiteNum(inp.l3_sub_hr) && finiteNum(inp.l3_sub_er))
  ) {
    out.push("L3");
  }
  return out;
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
  const lstar = selectLstar(inp.lstar_level, inp.l2_sec_er ?? null, inp.l3_sub_er ?? null, inp.threshold);

  const l1HedgeGross = hedgeGrossFromHrs(inp.l1_mkt_hr);
  const l2HedgeGross = hedgeGrossFromHrs(inp.l2_mkt_hr, inp.l2_sec_hr);
  const l3HedgeGross = hedgeGrossFromHrs(inp.l3_mkt_hr, inp.l3_sec_hr, inp.l3_sub_hr);

  // Start the economic ladder at the highest COMPLETE level at or below Lstar.
  // An incomplete level's gross omits its missing legs and its missing ER would
  // read as 0, so evaluating it would decide on values that do not exist.
  const incomplete = incompleteHedgeLevels(inp);
  let start: LStar | null = lstar;
  while (start && start !== "L1" && incomplete.includes(start)) {
    start = start === "L3" ? "L2" : "L1";
  }
  // From L3, a failing gate steps to L2; when L2 is incomplete that step must go
  // straight to L1 rather than test L2 on a 0 that stands in for a missing ER.
  let recommended = recommendHedgeLevel({
    lstar: start,
    l1HedgeGross,
    l2HedgeGross,
    l3HedgeGross,
    l2SectorEr: finiteNum(inp.l2_sec_er) ? inp.l2_sec_er : 0,
    l3SubsectorEr: finiteNum(inp.l3_sub_er) ? inp.l3_sub_er : 0,
    userSegment,
  });
  if (recommended !== "L1" && incomplete.includes(recommended)) recommended = "L1";

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
    incomplete_levels: incomplete,
  };
}

/**
 * Per-leg row in the hedge basket — what the chat renders.
 *
 *   leg                     — display label (ticker, "AAPL" / "SPY" / "XLK" / etc.)
 *   side                    — "long" | "short" (derived from sign of `position`);
 *                             null when position is null
 *   position                — signed HR (the +1 stock leg is +1.0; hedges are -HR);
 *                             null when the hedge ratio is unavailable (never 0)
 *   beta_to_spy             — leg's univariate slope on SPY (the market root);
 *                             null when the link beta is unavailable (never 0)
 *   beta_to_spy_r2          — r² of the sector-on-market link regression (sector
 *                             leg only; null on every other leg)
 *   market_beta_contribution — position × beta_to_spy (sums to net market β);
 *                             null when either factor is null
 */
export interface HedgeBasketLeg {
  leg: string;
  side: "long" | "short" | null;
  position: number | null;
  beta_to_spy: number | null;
  beta_to_spy_r2: number | null;
  market_beta_contribution: number | null;
}

/**
 * Data-quality codes on a hedge basket. A missing input is reported here and
 * the affected numbers are null — a null is never treated as 0.
 */
export type HedgeBasketDataQualityFlag =
  | "stock_market_beta_unavailable"
  | "market_hedge_ratio_unavailable"
  | "sector_hedge_ratio_unavailable"
  | "subsector_hedge_ratio_unavailable"
  | "sector_link_beta_unavailable"
  | "subsector_link_beta_unavailable"
  | "sector_link_beta_weak"
  | "link_betas_stale"
  | "link_betas_unavailable"
  | "hedge_level_inputs_incomplete";

/** Link betas older than this many trading days (weekdays) behind `as_of` are flagged stale. */
export const LINK_BETA_STALE_TRADING_DAYS = 10;
/** Link betas older than this many calendar days behind `as_of` are not used. */
export const LINK_BETA_MAX_AGE_CALENDAR_DAYS = 60;
/** A sector link with r² below this is flagged weakly identified. */
export const LINK_BETA_WEAK_R2 = 0.1;

/** Calendar and weekday gaps from `from` to `to` (ISO dates); null when either is unparseable. */
function dateGap(from: string, to: string): { calendar: number; weekdays: number } | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const DAY = 86_400_000;
  const calendar = Math.round((b - a) / DAY);
  let weekdays = 0;
  // Weekdays after `from` up to and including `to`. Exchange holidays are not
  // removed, so this can only overstate the trading-day gap (flags slightly early).
  for (let t = a + DAY; t <= b; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) weekdays += 1;
  }
  return { calendar, weekdays };
}

/**
 * Structured hedge-basket payload for `/api/hedge-basket/{ticker}` — what the
 * chat renders as the recommended level’s stock + ETF legs with a net-market-β subtotal.
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
  /** Σ market_beta_contribution; null when any leg's beta_to_spy is unavailable. */
  net_market_beta_after_hedge: number | null;
  /** Date of the link betas the ETF legs used; null when none were read. */
  link_betas_as_of: string | null;
  /** Empty when every input was available and current. */
  data_quality_flags: HedgeBasketDataQualityFlag[];
  /** Σ|HR| per level; null for a level whose inputs are incomplete. */
  hedge_gross: { L1: number | null; L2: number | null; L3: number | null };
  marginal_er: {
    L2_sector_raw: number | null;
    /** Null when the raw ER is null. */
    L2_sector_haircut: number | null;
    L3_subsector_raw: number | null;
    /** Null when the raw ER is null. */
    L3_subsector_haircut: number | null;
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
  /** r² of the sector-on-market link regression behind lambda_s_to_m. */
  lambda_s_to_m_r2?: number | null;
  /** Date of the link betas above (latest teo of the cohort store). */
  link_betas_as_of?: string | null;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

/**
 * Compose the basket payload from already-fetched inputs.
 *
 * Pure function — no IO. Caller is responsible for resolving link-betas from
 * the cohort store (`readLatestLinkBetas` in zarr-reader.ts) before calling
 * this. SPY-as-sector / SPY-as-subsector edge cases use λ=1.0 by convention.
 *
 * Fail-closed: a null beta or hedge ratio is never read as 0. The affected
 * leg's numbers are null, net_market_beta_after_hedge is null, and the gap is
 * named in data_quality_flags (RMAPI-30). Link betas more than
 * LINK_BETA_MAX_AGE_CALENDAR_DAYS behind `as_of` are not used; older than
 * LINK_BETA_STALE_TRADING_DAYS they are used and flagged stale.
 */
export function buildHedgeBasket(inp: BuildHedgeBasketInputs): HedgeBasket {
  const snap = computeHedgeRecommendationSnapshot(inp);
  const marketEtf = inp.market_etf_ticker ?? "SPY";

  // Conventions for SPY-rooted legs.
  const sectorIsSpy = inp.sector_etf_ticker?.toUpperCase() === marketEtf.toUpperCase();
  const subsectorIsSpy = inp.subsector_etf_ticker?.toUpperCase() === marketEtf.toUpperCase();
  const finiteOrNull = (x: number | null | undefined): number | null =>
    x != null && Number.isFinite(x) ? x : null;

  // The basket implements the final recommendation, with that level's entire
  // hedge vector. In particular SPY must not retain its L3 correction at L1/L2.
  const chosen = snap.recommended_hedge_level;
  const usesSector = chosen !== "L1" && !!inp.sector_etf_ticker && !sectorIsSpy;
  const usesSubsector = chosen === "L3" && !!inp.subsector_etf_ticker && !subsectorIsSpy;

  const flags: HedgeBasketDataQualityFlag[] = [];
  const flag = (f: HedgeBasketDataQualityFlag) => {
    if (!flags.includes(f)) flags.push(f);
  };

  // Link-beta age against the basket date. Beyond the hard limit the betas are
  // dropped (and reported unavailable below); within it but past the soft limit
  // they are used and flagged.
  // A link date after `as_of` would put future information into an older basket,
  // and an unknown gap cannot be checked: both are treated as unavailable.
  let linkBetasTooOld = false;
  if (usesSector || usesSubsector) {
    const gap =
      inp.link_betas_as_of && inp.as_of ? dateGap(inp.link_betas_as_of, inp.as_of) : null;
    if (!inp.link_betas_as_of) {
      flag("link_betas_unavailable");
    } else if (inp.as_of && (!gap || gap.calendar < 0)) {
      linkBetasTooOld = true;
      flag("link_betas_unavailable");
    } else if (gap && gap.calendar > LINK_BETA_MAX_AGE_CALENDAR_DAYS) {
      linkBetasTooOld = true;
    } else if (gap && gap.weekdays > LINK_BETA_STALE_TRADING_DAYS) {
      flag("link_betas_stale");
    }
  }
  const lambdaSM = sectorIsSpy ? 1.0 : linkBetasTooOld ? null : finiteOrNull(inp.lambda_s_to_m);
  const lambdaUM = subsectorIsSpy ? 1.0 : linkBetasTooOld ? null : finiteOrNull(inp.lambda_u_to_m);
  const lambdaSMR2 = lambdaSM !== null && !sectorIsSpy ? finiteOrNull(inp.lambda_s_to_m_r2) : null;

  const betaMAapl = finiteOrNull(inp.beta_m_aapl);
  if (betaMAapl === null) flag("stock_market_beta_unavailable");
  const product = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a * b;
  const sideOf = (p: number | null): "long" | "short" | null =>
    p === null ? null : p <= 0 ? "short" : "long";

  const hrM = finiteOrNull(chosen === "L1" ? inp.l1_mkt_hr : chosen === "L2" ? inp.l2_mkt_hr : inp.l3_mkt_hr);
  const hrS = finiteOrNull(chosen === "L2" ? inp.l2_sec_hr : inp.l3_sec_hr);
  const hrU = finiteOrNull(inp.l3_sub_hr);
  if (hrM === null) flag("market_hedge_ratio_unavailable");

  const legs: HedgeBasketLeg[] = [
    {
      leg: inp.ticker.toUpperCase(),
      side: "long",
      position: 1.0,
      beta_to_spy: betaMAapl,
      beta_to_spy_r2: null,
      market_beta_contribution: product(1.0, betaMAapl),
    },
    {
      leg: marketEtf,
      side: sideOf(hrM),
      position: hrM,
      beta_to_spy: 1.0,
      beta_to_spy_r2: null,
      market_beta_contribution: product(hrM, 1.0),
    },
  ];
  if (usesSector) {
    if (hrS === null) flag("sector_hedge_ratio_unavailable");
    if (lambdaSM === null) flag("sector_link_beta_unavailable");
    if (lambdaSMR2 !== null && lambdaSMR2 < LINK_BETA_WEAK_R2) flag("sector_link_beta_weak");
    legs.push({
      leg: inp.sector_etf_ticker!.toUpperCase(),
      side: sideOf(hrS),
      position: hrS,
      beta_to_spy: lambdaSM,
      beta_to_spy_r2: lambdaSMR2,
      market_beta_contribution: product(hrS, lambdaSM),
    });
  }
  if (usesSubsector) {
    if (hrU === null) flag("subsector_hedge_ratio_unavailable");
    if (lambdaUM === null) flag("subsector_link_beta_unavailable");
    legs.push({
      leg: inp.subsector_etf_ticker!.toUpperCase(),
      side: sideOf(hrU),
      position: hrU,
      beta_to_spy: lambdaUM,
      beta_to_spy_r2: null,
      market_beta_contribution: product(hrU, lambdaUM),
    });
  }

  // A leg with an unknown beta makes the subtotal unknown — never sum around it.
  const netMarketBetaAfterHedge = legs.some((l) => l.market_beta_contribution === null)
    ? null
    : legs.reduce((acc, l) => acc + (l.market_beta_contribution as number), 0);

  // Decision-trace narration. Mirrors the recommendHedgeLevel decision logic
  // so the user can see WHY recommended_hedge_level may diverge from lstar.
  const trace: string[] = [];
  const threshold = inp.threshold ?? LSTAR_DEFAULT_THRESHOLD;
  const lstar = snap.lstar;
  const subRawNn = finiteOrNull(inp.l3_sub_er);
  const secRawNn = finiteOrNull(inp.l2_sec_er);
  const pct = (x: number | null) => (x === null ? "n/a" : fmtPct(x));
  if (inp.threshold === undefined && inp.lstar_level !== undefined) {
    trace.push(`Lstar=${lstar ?? "null"} (materialized engine selection)`);
  } else if (lstar === null) {
    trace.push(
      `Lstar=null (both L2 and L3 marginal ER unavailable — pre-IPO / delisted / masked); recommendation defaults to L1.`,
    );
  } else if (lstar === "L3") {
    trace.push(
      `Lstar=L3 (subsector marginal ER ${pct(subRawNn)} ≥ ${fmtPct(threshold)} threshold)`,
    );
  } else if (lstar === "L2") {
    trace.push(
      `Lstar=L2 (sector marginal ER ${pct(secRawNn)} ≥ ${fmtPct(threshold)} threshold; subsector ${pct(subRawNn)} fails)`,
    );
  } else {
    trace.push(`Lstar=L1 (sector ${pct(secRawNn)} and subsector ${pct(subRawNn)} both fail ${fmtPct(threshold)} threshold)`);
  }

  const cap = snap.leverage_cap_applied;
  const erHaircut = DEFAULT_ER_HAIRCUT;
  const minHaircut = DEFAULT_MIN_HAIRCUT_ER;
  const incomplete = snap.incomplete_levels;
  const rank = (l: LStar) => (l === "L1" ? 1 : l === "L2" ? 2 : 3);
  // Walk the candidate ladder mirroring computeHedgeRecommendationSnapshot.
  let candidate: LStar = (lstar ?? "L1") as LStar;
  if (incomplete.some((l) => rank(l) > rank(snap.recommended_hedge_level) && rank(l) <= rank(candidate))) {
    flag("hedge_level_inputs_incomplete");
  }
  if (candidate === "L3" && incomplete.includes("L3")) {
    trace.push(`L3 inputs incomplete (a hedge ratio or the subsector ER is missing) → not evaluated, drop to L2`);
    candidate = "L2";
  } else if (candidate === "L3") {
    const haircut = (subRawNn as number) * erHaircut;
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
  if (candidate === "L2" && incomplete.includes("L2")) {
    trace.push(`L2 inputs incomplete (a hedge ratio or the sector ER is missing) → not evaluated, drop to L1`);
    candidate = "L1";
  } else if (candidate === "L2") {
    const haircut = (secRawNn as number) * erHaircut;
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
    link_betas_as_of: inp.link_betas_as_of ?? null,
    data_quality_flags: flags,
    hedge_gross: {
      L1: incomplete.includes("L1") ? null : snap.l1_hedge_gross,
      L2: incomplete.includes("L2") ? null : snap.l2_hedge_gross,
      L3: incomplete.includes("L3") ? null : snap.l3_hedge_gross,
    },
    marginal_er: {
      L2_sector_raw: secRawNn,
      L2_sector_haircut: secRawNn === null ? null : secRawNn * erHaircut,
      L3_subsector_raw: subRawNn,
      L3_subsector_haircut: subRawNn === null ? null : subRawNn * erHaircut,
    },
    decision_trace: trace,
  };
}
