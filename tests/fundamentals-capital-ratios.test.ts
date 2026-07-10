import { describe, expect, it } from "vitest";
import {
  buybackRatio,
  payoutRatio,
  retentionRatio,
  sustainableGrowth,
  totalPayoutRatio,
} from "@/lib/dal/fundamentals-zarr-reader";

describe("capital-return ratios (Phase 2)", () => {
  it("payout = dividends_declared / net_income; retention = 1 - payout", () => {
    expect(payoutRatio(30, 100)).toBeCloseTo(0.3);
    expect(retentionRatio(30, 100)).toBeCloseTo(0.7);
  });

  it("null (NaN) when net income is <= 0 — a payout on non-positive earnings is meaningless", () => {
    expect(payoutRatio(30, 0)).toBeNaN();
    expect(payoutRatio(30, -50)).toBeNaN();
    expect(retentionRatio(30, -50)).toBeNaN();
    expect(buybackRatio(20, 0)).toBeNaN();
  });

  it("buyback and total-payout ratios", () => {
    expect(buybackRatio(80, 100)).toBeCloseTo(0.8);
    expect(totalPayoutRatio(30, 80, 100)).toBeCloseTo(1.1); // returns can exceed earnings
  });

  it("total-payout treats a missing leg as zero but needs at least one present", () => {
    expect(totalPayoutRatio(30, NaN, 100)).toBeCloseTo(0.3); // dividends only
    expect(totalPayoutRatio(NaN, 80, 100)).toBeCloseTo(0.8); // buybacks only
    expect(totalPayoutRatio(NaN, NaN, 100)).toBeNaN(); // nothing to sum → null
  });

  it("sustainable growth g = retention * roe", () => {
    expect(sustainableGrowth(0.7, 0.2)).toBeCloseTo(0.14);
    expect(sustainableGrowth(NaN, 0.2)).toBeNaN();
  });
});
