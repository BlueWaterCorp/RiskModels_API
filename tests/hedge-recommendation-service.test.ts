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
