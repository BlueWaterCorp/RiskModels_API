/**
 * RMAPI-30 — the hedge basket's sector leg reported beta_to_spy = 0.
 *
 * The route read link betas from the retired `ds_erm3_link_betas_SPY.zarr`,
 * which is no longer published. The open failed, the null was turned into 0,
 * and net_market_beta_after_hedge dropped the sector leg (NVDA showed 1.90).
 *
 * Link-beta fixture values are real cells from the published cohort store
 * `ds_erm3_cohorts_SPY_uni_mc_3000.zarr` at teo 2026-10-23 (its latest teo in
 * the 2026-11-05 release): linked_beta at link_policy="hedge" and
 * linked_beta_mkt. The AAPL hedge ratios are the live 2026-05-18 values already
 * used in hedge-recommendation-service.test.ts; AAPL's sector ETF is XLK, the
 * same as NVDA's.
 */
import { describe, expect, it } from "vitest";

import { mapCohortLinkBetas } from "@/lib/dal/zarr-reader";
import { buildHedgeBasket } from "@/lib/risk/hedge-recommendation-service";

const COHORT_TEO = "2026-10-23";
// cohort_level 2 (sector; parent = market): linked_beta is the slope on SPY.
const XLK = { level: 2, linked_beta: 1.7590864896774292, linked_beta_mkt: 1.7590864896774292 };
// cohort_level 3 (subsector): linked_beta on its sector, linked_beta_mkt on SPY.
const SOXX = { level: 3, linked_beta: 2.2708287239074707, linked_beta_mkt: 2.6149649620056152 };
// cohort_level 1 (the market root): no link coefficient.
const SPY_COHORT = { level: 1, linked_beta: null, linked_beta_mkt: null };

const aaplL3 = {
  ticker: "AAPL",
  as_of: "2026-05-18",
  l1_mkt_hr: -0.862,
  l2_mkt_hr: -1.396,
  l2_sec_hr: 0.357,
  l3_mkt_hr: -2.002,
  l3_sec_hr: -0.026,
  l3_sub_hr: 0.41,
  l2_sec_er: 0.007,
  l3_sub_er: 0.02,
  beta_m_aapl: 0.862,
  sector_etf_ticker: "XLK",
  subsector_etf_ticker: "SOXX",
  user_segment: "ls_equity" as const, // 3.0× cap holds AAPL at L3, so every ETF leg is present
};

describe("mapCohortLinkBetas — cohort store → basket lambdas", () => {
  it("reads XLK's slope on SPY from the level-2 cohort (NVDA / AAPL sector leg)", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, XLK, SOXX);
    expect(lb.teo).toBe(COHORT_TEO);
    expect(lb.lambda_s_to_m).toBeCloseTo(1.759086, 6);
    expect(lb.lambda_u_to_m).toBeCloseTo(2.614965, 6);
    expect(lb.lambda_u_to_s).toBeCloseTo(2.270829, 6);
  });

  it("a ticker missing from the roster or a non-sector cohort gives null, never 0", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, null, null);
    expect(lb.lambda_s_to_m).toBeNull();
    expect(lb.lambda_u_to_m).toBeNull();
    expect(lb.lambda_u_to_s).toBeNull();
    // A level-3 or level-1 cohort in the sector slot is not a sector link.
    expect(mapCohortLinkBetas(COHORT_TEO, SOXX, null).lambda_s_to_m).toBeNull();
    expect(mapCohortLinkBetas(COHORT_TEO, SPY_COHORT, null).lambda_s_to_m).toBeNull();
  });

  it("a NaN cell is null", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, { level: 2, linked_beta: NaN, linked_beta_mkt: NaN }, null);
    expect(lb.lambda_s_to_m).toBeNull();
  });

  it("a sector ETF standing in for the subsector supplies λ_u→m from its market link", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, XLK, XLK);
    expect(lb.lambda_u_to_m).toBeCloseTo(1.759086, 6);
    expect(lb.lambda_u_to_s).toBeNull();
  });
});

describe("buildHedgeBasket — sector leg beta_to_spy (RMAPI-30)", () => {
  it("uses the cohort-store link betas and sums every leg into net market β", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, XLK, SOXX);
    const basket = buildHedgeBasket({
      ...aaplL3,
      lambda_s_to_m: lb.lambda_s_to_m,
      lambda_u_to_m: lb.lambda_u_to_m,
      link_betas_as_of: lb.teo,
    });
    expect(basket.recommended_hedge_level).toBe("L3");
    expect(basket.legs.map((l) => l.leg)).toEqual(["AAPL", "SPY", "XLK", "SOXX"]);
    const xlk = basket.legs[2]!;
    expect(xlk.beta_to_spy).toBeCloseTo(1.759086, 6);
    expect(xlk.beta_to_spy).not.toBe(0);
    expect(xlk.market_beta_contribution).toBeCloseTo(-0.026 * 1.7590864896774292, 9);
    const expected =
      0.862 * 1 + -2.002 * 1 + -0.026 * 1.7590864896774292 + 0.41 * 2.6149649620056152;
    expect(basket.net_market_beta_after_hedge).toBeCloseTo(expected, 9);
    expect(basket.data_quality_flags).toEqual([]);
    expect(basket.link_betas_as_of).toBe(COHORT_TEO);
  });

  it("a missing sector link beta is null with a flag, and net market β is null — not 0", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, null, SOXX);
    const basket = buildHedgeBasket({
      ...aaplL3,
      lambda_s_to_m: lb.lambda_s_to_m,
      lambda_u_to_m: lb.lambda_u_to_m,
      link_betas_as_of: lb.teo,
    });
    const xlk = basket.legs.find((l) => l.leg === "XLK")!;
    expect(xlk.position).toBeCloseTo(-0.026, 6); // the dollar leg is unaffected
    expect(xlk.beta_to_spy).toBeNull();
    expect(xlk.market_beta_contribution).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual(["sector_link_beta_unavailable"]);
  });

  it("an unreadable store flags both ETF legs", () => {
    const basket = buildHedgeBasket({ ...aaplL3, lambda_s_to_m: null, lambda_u_to_m: null });
    expect(basket.data_quality_flags).toEqual([
      "sector_link_beta_unavailable",
      "subsector_link_beta_unavailable",
    ]);
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.link_betas_as_of).toBeNull();
  });

  it("a missing stock beta is flagged rather than read as 0", () => {
    const lb = mapCohortLinkBetas(COHORT_TEO, XLK, SOXX);
    const basket = buildHedgeBasket({
      ...aaplL3,
      beta_m_aapl: null,
      lambda_s_to_m: lb.lambda_s_to_m,
      lambda_u_to_m: lb.lambda_u_to_m,
    });
    expect(basket.legs[0]!.beta_to_spy).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual(["stock_market_beta_unavailable"]);
  });

  it("an L1 basket needs no link betas and stays fully computed", () => {
    const basket = buildHedgeBasket({
      ...aaplL3,
      user_segment: "family_office", // 2.0× cap downgrades AAPL to L1
      lambda_s_to_m: null,
      lambda_u_to_m: null,
    });
    expect(basket.recommended_hedge_level).toBe("L1");
    expect(basket.data_quality_flags).toEqual([]);
    expect(basket.net_market_beta_after_hedge).toBeCloseTo(0, 6);
  });
});
