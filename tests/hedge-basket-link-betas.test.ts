/**
 * RMAPI-30 — the hedge basket's sector leg reported beta_to_spy = 0.
 *
 * The route read link betas from the retired `ds_erm3_link_betas_SPY.zarr`,
 * which is no longer published. The open failed, the null was turned into 0,
 * and net_market_beta_after_hedge dropped the sector leg (NVDA showed 1.90).
 *
 * Every link-beta value below is a real cell from the published cohort store
 * `ds_erm3_cohorts_SPY_uni_mc_3000.zarr` in the 2026-11-05 release
 * (linked_beta at link_policy="hedge", linked_beta_mkt, linked_beta_r2), at
 * two dates:
 *   - 2026-05-18, the date of the live AAPL hedge ratios used for the baskets
 *     (the same ratios as hedge-recommendation-service.test.ts), so a basket is
 *     never paired with link betas from after its own date;
 *   - 2026-10-23, the store's latest teo, used for the mapping tests and for
 *     the future-link refusal.
 * AAPL's sector ETF is XLK, the same as NVDA's.
 */
import { describe, expect, it } from "vitest";

import { mapCohortLinkBetas } from "@/lib/dal/zarr-reader";
import { buildHedgeBasket } from "@/lib/risk/hedge-recommendation-service";

// ── 2026-10-23 (latest teo) ─────────────────────────────────────────────────
const LATEST_TEO = "2026-10-23";
const XLK_1023 = {
  level: 2,
  linked_beta: 1.7590864896774292,
  linked_beta_mkt: 1.7590864896774292,
  linked_beta_r2: 0.7183336615562439,
};
const SOXX_1023 = { level: 3, linked_beta: 2.2708287239074707, linked_beta_mkt: 2.6149649620056152 };
const SPY_COHORT = { level: 1, linked_beta: null, linked_beta_mkt: null };

// ── 2026-05-18 (the AAPL basket date) ───────────────────────────────────────
const BASKET_TEO = "2026-05-18";
const XLK_0518 = {
  level: 2,
  linked_beta: 1.4942604303359985,
  linked_beta_mkt: 1.4942604303359985,
  linked_beta_r2: 0.7797532677650452,
};
// XLE on the same date: a market link that is barely identified (r² 0.0009).
const XLE_0518 = {
  level: 2,
  linked_beta: -0.05042817443609238,
  linked_beta_mkt: -0.05042817443609238,
  linked_beta_r2: 0.0009213582379743457,
};
const SOXX_0518 = {
  level: 3,
  linked_beta: 1.8388744592666626,
  linked_beta_mkt: 2.0817136764526367,
  linked_beta_r2: 0.29408857226371765,
};

const aaplL3 = {
  ticker: "AAPL",
  as_of: BASKET_TEO,
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

const linksAt0518 = mapCohortLinkBetas(BASKET_TEO, XLK_0518, SOXX_0518);
const withLinks = (lb: ReturnType<typeof mapCohortLinkBetas>) => ({
  lambda_s_to_m: lb.lambda_s_to_m,
  lambda_u_to_m: lb.lambda_u_to_m,
  lambda_s_to_m_r2: lb.lambda_s_to_m_r2,
  link_betas_as_of: lb.teo,
});

describe("mapCohortLinkBetas — cohort store → basket lambdas", () => {
  it("reads XLK's slope on SPY from the level-2 cohort (NVDA / AAPL sector leg)", () => {
    const lb = mapCohortLinkBetas(LATEST_TEO, XLK_1023, SOXX_1023);
    expect(lb.teo).toBe(LATEST_TEO);
    expect(lb.lambda_s_to_m).toBeCloseTo(1.759086, 6);
    expect(lb.lambda_s_to_m_r2).toBeCloseTo(0.718334, 6);
    expect(lb.lambda_u_to_m).toBeCloseTo(2.614965, 6);
    expect(lb.lambda_u_to_s).toBeCloseTo(2.270829, 6);
  });

  it("a ticker missing from the roster or a non-sector cohort gives null, never 0", () => {
    const lb = mapCohortLinkBetas(LATEST_TEO, null, null);
    expect(lb.lambda_s_to_m).toBeNull();
    expect(lb.lambda_u_to_m).toBeNull();
    expect(lb.lambda_u_to_s).toBeNull();
    expect(mapCohortLinkBetas(LATEST_TEO, SOXX_1023, null).lambda_s_to_m).toBeNull();
    expect(mapCohortLinkBetas(LATEST_TEO, SPY_COHORT, null).lambda_s_to_m).toBeNull();
  });

  it("a NaN cell is null", () => {
    const lb = mapCohortLinkBetas(LATEST_TEO, { level: 2, linked_beta: NaN, linked_beta_mkt: NaN }, null);
    expect(lb.lambda_s_to_m).toBeNull();
  });

  it("a sector ETF standing in for the subsector supplies λ_u→m from its market link", () => {
    const lb = mapCohortLinkBetas(LATEST_TEO, XLK_1023, XLK_1023);
    expect(lb.lambda_u_to_m).toBeCloseTo(1.759086, 6);
    expect(lb.lambda_u_to_s).toBeNull();
  });
});

describe("buildHedgeBasket — sector leg beta_to_spy (RMAPI-30)", () => {
  it("uses same-date link betas and sums every leg into net market β", () => {
    const basket = buildHedgeBasket({ ...aaplL3, ...withLinks(linksAt0518) });
    expect(basket.recommended_hedge_level).toBe("L3");
    expect(basket.legs.map((l) => l.leg)).toEqual(["AAPL", "SPY", "XLK", "SOXX"]);
    const xlk = basket.legs[2]!;
    expect(xlk.beta_to_spy).toBeCloseTo(1.494260, 6);
    expect(xlk.beta_to_spy_r2).toBeCloseTo(0.779753, 6);
    expect(xlk.market_beta_contribution).toBeCloseTo(-0.026 * 1.4942604303359985, 9);
    const expected =
      0.862 * 1 + -2.002 * 1 + -0.026 * 1.4942604303359985 + 0.41 * 2.0817136764526367;
    expect(basket.net_market_beta_after_hedge).toBeCloseTo(expected, 9);
    expect(basket.legs.map((l) => l.beta_to_spy_r2 === null)).toEqual([true, true, false, true]);
    expect(basket.data_quality_flags).toEqual([]);
    expect(basket.link_betas_as_of).toBe(BASKET_TEO);
  });

  it("link betas dated after the basket are refused, not used", () => {
    const future = mapCohortLinkBetas(LATEST_TEO, XLK_1023, SOXX_1023); // 2026-10-23 > 2026-05-18
    const basket = buildHedgeBasket({ ...aaplL3, ...withLinks(future) });
    expect(basket.legs[2]!.beta_to_spy).toBeNull();
    expect(basket.legs[3]!.beta_to_spy).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual([
      "link_betas_unavailable",
      "sector_link_beta_unavailable",
      "subsector_link_beta_unavailable",
    ]);
  });

  it("no link betas at all (unreadable store, or none on or before as_of) are flagged", () => {
    const basket = buildHedgeBasket({ ...aaplL3, lambda_s_to_m: null, lambda_u_to_m: null });
    expect(basket.data_quality_flags).toEqual([
      "link_betas_unavailable",
      "sector_link_beta_unavailable",
      "subsector_link_beta_unavailable",
    ]);
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.link_betas_as_of).toBeNull();
  });

  it("a missing sector link beta is null with a flag, and net market β is null — not 0", () => {
    const lb = mapCohortLinkBetas(BASKET_TEO, null, SOXX_0518);
    const basket = buildHedgeBasket({ ...aaplL3, ...withLinks(lb) });
    const xlk = basket.legs.find((l) => l.leg === "XLK")!;
    expect(xlk.position).toBeCloseTo(-0.026, 6); // the dollar leg is unaffected
    expect(xlk.beta_to_spy).toBeNull();
    expect(xlk.market_beta_contribution).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual(["sector_link_beta_unavailable"]);
  });

  it("a missing stock beta is flagged rather than read as 0", () => {
    const basket = buildHedgeBasket({ ...aaplL3, beta_m_aapl: null, ...withLinks(linksAt0518) });
    expect(basket.legs[0]!.beta_to_spy).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual(["stock_market_beta_unavailable"]);
  });

  it("a weakly identified sector link (XLE, r² 0.0009) is used and flagged", () => {
    const lb = mapCohortLinkBetas(BASKET_TEO, XLE_0518, SOXX_0518);
    const basket = buildHedgeBasket({ ...aaplL3, sector_etf_ticker: "XLE", ...withLinks(lb) });
    const xle = basket.legs.find((l) => l.leg === "XLE")!;
    expect(xle.beta_to_spy).toBeCloseTo(-0.050428, 6);
    expect(basket.data_quality_flags).toEqual(["sector_link_beta_weak"]);
    expect(basket.net_market_beta_after_hedge).not.toBeNull();
  });

  it("link betas more than 10 trading days behind as_of are used and flagged stale", () => {
    const at = (as_of: string) => buildHedgeBasket({ ...aaplL3, as_of, ...withLinks(linksAt0518) });
    // 2026-05-18 → 2026-06-01 is 10 weekdays: not yet stale.
    expect(at("2026-06-01").data_quality_flags).toEqual([]);
    // → 2026-06-02 is 11 weekdays: stale, still used.
    const stale = at("2026-06-02");
    expect(stale.data_quality_flags).toEqual(["link_betas_stale"]);
    expect(stale.legs[2]!.beta_to_spy).toBeCloseTo(1.494260, 6);
    expect(stale.net_market_beta_after_hedge).not.toBeNull();
  });

  it("link betas more than 60 calendar days behind as_of are not used", () => {
    const basket = buildHedgeBasket({ ...aaplL3, as_of: "2026-07-18", ...withLinks(linksAt0518) }); // 61 days
    expect(basket.legs[2]!.beta_to_spy).toBeNull();
    expect(basket.legs[3]!.beta_to_spy).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual([
      "sector_link_beta_unavailable",
      "subsector_link_beta_unavailable",
    ]);
  });

  it("a null market hedge ratio is flagged too", () => {
    const basket = buildHedgeBasket({
      ...aaplL3,
      user_segment: "family_office",
      l1_mkt_hr: null,
      lambda_s_to_m: null,
      lambda_u_to_m: null,
    });
    expect(basket.recommended_hedge_level).toBe("L1");
    expect(basket.legs[1]!.position).toBeNull();
    expect(basket.net_market_beta_after_hedge).toBeNull();
    expect(basket.data_quality_flags).toEqual(["market_hedge_ratio_unavailable"]);
    expect(basket.hedge_gross.L1).toBeNull();
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

describe("level selection never decides on a missing value", () => {
  it("a missing hedge ratio keeps its level from being recommended (L3 → evaluated L2 → L1)", () => {
    // With every input present, ls_equity holds AAPL at L3 (gross 2.438 ≤ 3.0, haircut ER 1.4%).
    // Without l3_sub_hr the L3 gross would omit the leg (2.028) and still pass; it must not.
    const basket = buildHedgeBasket({ ...aaplL3, l3_sub_hr: null, ...withLinks(linksAt0518) });
    expect(basket.lstar).toBe("L3");
    // L2 is evaluated on real values: gross 1.753 passes, haircut ER 0.49% < 1% floor → L1.
    expect(basket.recommended_hedge_level).toBe("L1");
    expect(basket.hedge_gross.L3).toBeNull();
    expect(basket.hedge_gross.L2).toBeCloseTo(1.753, 6);
    expect(basket.data_quality_flags).toEqual(["hedge_level_inputs_incomplete"]);
    expect(basket.decision_trace.some((s) => /L3 inputs incomplete/.test(s))).toBe(true);
    expect(basket.decision_trace.some((s) => /L2 sector haircut/.test(s))).toBe(true);
  });

  it("a missing marginal ER keeps its level from being recommended, and its haircut is null", () => {
    const basket = buildHedgeBasket({
      ...aaplL3,
      lstar_level: 3, // the engine's materialized pick is L3
      l3_sub_er: null,
      ...withLinks(linksAt0518),
    });
    expect(basket.lstar).toBe("L3");
    expect(basket.recommended_hedge_level).toBe("L1");
    expect(basket.marginal_er.L3_subsector_raw).toBeNull();
    expect(basket.marginal_er.L3_subsector_haircut).toBeNull();
    expect(basket.marginal_er.L2_sector_haircut).toBeCloseTo(0.0049, 9);
    expect(basket.hedge_gross.L3).toBeNull();
    expect(basket.data_quality_flags).toEqual(["hedge_level_inputs_incomplete"]);
  });
});
