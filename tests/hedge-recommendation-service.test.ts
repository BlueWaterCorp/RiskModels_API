/**
 * Tests for the snapshot orchestrator that composes Lstar (statistical pick)
 * with the economic recommendation rule into the metrics-endpoint payload
 * fields. Core decision math is exercised in `hedge-recommendation.test.ts`;
 * here we pin the orchestration: live-derived Lstar, NaN-safe hedge gross
 * from the raw metric scalars, the haircut formula, and user_segment guards.
 */
import { describe, expect, it } from "vitest";

import { SEGMENT_LEVERAGE_CAPS } from "@/lib/dal/hedge-recommendation";
import {
  buildHedgeBasket,
  computeHedgeRecommendationSnapshot,
  isValidUserSegment,
  VALID_USER_SEGMENTS,
} from "@/lib/risk/hedge-recommendation-service";

describe("isValidUserSegment", () => {
  it("accepts the four documented segments", () => {
    for (const s of VALID_USER_SEGMENTS) {
      expect(isValidUserSegment(s)).toBe(true);
    }
  });

  it("rejects null, empty, and unknown values", () => {
    expect(isValidUserSegment(null)).toBe(false);
    expect(isValidUserSegment(undefined)).toBe(false);
    expect(isValidUserSegment("")).toBe(false);
    expect(isValidUserSegment("retail-aggressive")).toBe(false);
    expect(isValidUserSegment("RETAIL")).toBe(false);
  });
});

describe("computeHedgeRecommendationSnapshot — AAPL today (shrunk-ish scalars)", () => {
  // Values aligned with the live AAPL inputs at 2026-05-18 (see Phase B1.1
  // ground-test). HRs from raw ds_erm3_hedge_weights; ERs from the shrunk
  // sidecar but the metrics route currently reads raw ERs from Supabase
  // — the AAPL test uses raw ER 0.7% / 2.0% to match what the route actually
  // gets at runtime today. Drop-in for shrunk ERs lands when Phase 2.5 wires
  // the shrunk sidecar through zarr-reader.
  const aaplInputs = {
    l1_mkt_hr: -0.862,
    l2_mkt_hr: -1.396,
    l2_sec_hr:  0.357,
    l3_mkt_hr: -2.002,
    l3_sec_hr: -0.026,
    l3_sub_hr:  0.410,
    l2_sec_er:  0.007,    // 0.7% raw → fails 1% Lstar threshold
    l3_sub_er:  0.020,    // 2.0% raw → clears 1% Lstar threshold → Lstar=L3
  } as const;

  it("derives lstar=L3 live from raw ERs (1% threshold)", () => {
    const snap = computeHedgeRecommendationSnapshot(aaplInputs);
    expect(snap.lstar).toBe("L3");
  });

  it("family_office (default 2.0× cap) downgrades AAPL to L1", () => {
    const snap = computeHedgeRecommendationSnapshot(aaplInputs);
    expect(snap.recommended_hedge_level).toBe("L1");
    expect(snap.user_segment_applied).toBe("family_office");
    expect(snap.leverage_cap_applied).toBe(2.0);
  });

  it("ls_equity (3.0× cap) holds AAPL at L3", () => {
    const snap = computeHedgeRecommendationSnapshot({
      ...aaplInputs,
      user_segment: "ls_equity",
    });
    expect(snap.recommended_hedge_level).toBe("L3");
    expect(snap.leverage_cap_applied).toBe(3.0);
  });

  it("hedge gross at each level matches |HR| sums", () => {
    const snap = computeHedgeRecommendationSnapshot(aaplInputs);
    expect(snap.l1_hedge_gross).toBeCloseTo(0.862, 3);
    expect(snap.l2_hedge_gross).toBeCloseTo(1.753, 3);  // 1.396 + 0.357
    expect(snap.l3_hedge_gross).toBeCloseTo(2.438, 3);  // 2.002 + 0.026 + 0.410
  });

  it("higher_er_haircut = (l2_sec_er + l3_sub_er) × 0.7", () => {
    const snap = computeHedgeRecommendationSnapshot(aaplInputs);
    expect(snap.higher_er_haircut).toBeCloseTo((0.007 + 0.020) * 0.7, 6);
  });
});

describe("computeHedgeRecommendationSnapshot — edge cases", () => {
  it("falls back to family_office on missing user_segment", () => {
    const snap = computeHedgeRecommendationSnapshot({
      l1_mkt_hr: -0.5,
      l2_mkt_hr: -0.5,
      l2_sec_hr: 0.0,
      l3_mkt_hr: -0.5,
      l3_sec_hr: 0.0,
      l3_sub_hr: 0.0,
      l2_sec_er: 0.05,
      l3_sub_er: 0.05,
    });
    expect(snap.user_segment_applied).toBe("family_office");
    expect(snap.leverage_cap_applied).toBe(SEGMENT_LEVERAGE_CAPS.family_office);
  });

  it("null ERs → null Lstar → recommended L1", () => {
    const snap = computeHedgeRecommendationSnapshot({
      l1_mkt_hr: -0.5,
      l2_mkt_hr: -0.5,
      l2_sec_hr: 0.0,
      l3_mkt_hr: -0.5,
      l3_sec_hr: 0.0,
      l3_sub_hr: 0.0,
      l2_sec_er: null,
      l3_sub_er: null,
    });
    expect(snap.lstar).toBeNull();
    expect(snap.recommended_hedge_level).toBe("L1");
    expect(snap.higher_er_haircut).toBe(0);
  });

  it("partially-null HRs are NaN-safe (treated as 0 contribution)", () => {
    const snap = computeHedgeRecommendationSnapshot({
      l1_mkt_hr: -0.5,
      l2_mkt_hr: null,
      l2_sec_hr: null,
      l3_mkt_hr: -0.5,
      l3_sec_hr: null,
      l3_sub_hr: 0.3,
      l2_sec_er: 0.0,
      l3_sub_er: 0.05,
    });
    expect(snap.l1_hedge_gross).toBeCloseTo(0.5, 6);
    expect(snap.l2_hedge_gross).toBe(0);
    expect(snap.l3_hedge_gross).toBeCloseTo(0.8, 6);
  });

  it("buildHedgeBasket for AAPL (live numbers, family_office) — 4 legs, L3→L1 downgrade trace", () => {
    const basket = buildHedgeBasket({
      ticker: "AAPL",
      as_of: "2026-05-18",
      l1_mkt_hr: -0.862,
      l2_mkt_hr: -1.396,
      l2_sec_hr:  0.357,
      l3_mkt_hr: -2.002,
      l3_sec_hr: -0.026,
      l3_sub_hr:  0.410,
      l2_sec_er:  0.007,
      l3_sub_er:  0.020,
      beta_m_aapl: 0.862,
      sector_etf_ticker: "XLK",
      subsector_etf_ticker: "SOXX",
      lambda_s_to_m: 1.497,
      lambda_u_to_m: 1.478,
      user_segment: "family_office",
    });

    expect(basket.ticker).toBe("AAPL");
    expect(basket.lstar).toBe("L3");
    expect(basket.recommended_hedge_level).toBe("L1");      // downgraded
    expect(basket.user_segment_applied).toBe("family_office");
    expect(basket.leverage_cap_applied).toBe(2.0);
    expect(basket.haircut_applied).toBe(0.7);

    // Four legs: AAPL + SPY + XLK + SOXX
    expect(basket.legs).toHaveLength(4);
    expect(basket.legs[0]!.leg).toBe("AAPL");
    expect(basket.legs[0]!.side).toBe("long");
    expect(basket.legs[0]!.market_beta_contribution).toBeCloseTo(0.862, 3);
    expect(basket.legs[1]!.leg).toBe("SPY");
    expect(basket.legs[1]!.side).toBe("short");
    expect(basket.legs[1]!.market_beta_contribution).toBeCloseTo(-2.002, 3);
    expect(basket.legs[2]!.leg).toBe("XLK");
    expect(basket.legs[2]!.market_beta_contribution).toBeCloseTo(-0.026 * 1.497, 3);
    expect(basket.legs[3]!.leg).toBe("SOXX");
    expect(basket.legs[3]!.side).toBe("long");
    expect(basket.legs[3]!.market_beta_contribution).toBeCloseTo(0.410 * 1.478, 3);

    // Net market β (the residual the methodology task #22 is investigating)
    const expectedNet =
      0.862 + (-2.002) * 1.0 + (-0.026) * 1.497 + 0.410 * 1.478;
    expect(basket.net_market_beta_after_hedge).toBeCloseTo(expectedNet, 3);

    // Decision trace narrates the two downgrades + final.
    expect(basket.decision_trace.length).toBeGreaterThanOrEqual(3);
    expect(basket.decision_trace[0]).toMatch(/Lstar=L3/);
    expect(basket.decision_trace.some((s) => /L3 hedge gross/.test(s))).toBe(true);
    expect(basket.decision_trace.some((s) => /L2 sector haircut/.test(s))).toBe(true);
    expect(basket.decision_trace[basket.decision_trace.length - 1]).toBe("Final: L1");
  });

  it("buildHedgeBasket — SPY-as-sector convention (λ=1.0, no XLK leg)", () => {
    const basket = buildHedgeBasket({
      ticker: "SPY",
      as_of: "2026-05-18",
      l1_mkt_hr: -1.0,
      l2_mkt_hr: -1.0,
      l2_sec_hr: 0.0,
      l3_mkt_hr: -1.0,
      l3_sec_hr: 0.0,
      l3_sub_hr: 0.0,
      l2_sec_er: 0.0,
      l3_sub_er: 0.0,
      beta_m_aapl: 1.0,
      sector_etf_ticker: "SPY",
      subsector_etf_ticker: "SPY",
      lambda_s_to_m: null,
      lambda_u_to_m: null,
      user_segment: "retail",
    });
    // Only one hedge leg (the SPY hedge); SPY sector/subsector are deduped.
    expect(basket.legs.map((l) => l.leg)).toEqual(["SPY", "SPY"]);
    expect(basket.legs[0]!.side).toBe("long");
    expect(basket.legs[1]!.side).toBe("short");
    expect(basket.net_market_beta_after_hedge).toBeCloseTo(0, 6);
  });

  it("custom threshold flips lstar without affecting hedge gross", () => {
    const inputs = {
      l1_mkt_hr: -0.5,
      l2_mkt_hr: -0.5,
      l2_sec_hr: 0.0,
      l3_mkt_hr: -0.5,
      l3_sec_hr: 0.0,
      l3_sub_hr: 0.0,
      l2_sec_er: 0.02,    // clears 1% but not 5%
      l3_sub_er: 0.001,
    };
    const at1pct = computeHedgeRecommendationSnapshot({ ...inputs, threshold: 0.01 });
    const at5pct = computeHedgeRecommendationSnapshot({ ...inputs, threshold: 0.05 });
    expect(at1pct.lstar).toBe("L2");
    expect(at5pct.lstar).toBe("L1");
    expect(at1pct.l2_hedge_gross).toEqual(at5pct.l2_hedge_gross);
  });
});
