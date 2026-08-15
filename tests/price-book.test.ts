import { describe, expect, it } from "vitest";
import {
  calculateRequestCost,
  getCapabilityById,
  PRICE_BOOK,
} from "@/lib/agent/capabilities";

describe("price book 2026-08-14", () => {
  it("keeps discovery endpoints free", () => {
    for (const id of ["ticker-search", "fund-search", "filer-search", "health-status", "cohorts-roster"]) {
      expect(calculateRequestCost(id)).toBe(0);
    }
  });

  it("prices ticker-returns as $0.02 + $0.01 per extra year (R3)", () => {
    expect(calculateRequestCost("ticker-returns", undefined, undefined, undefined, 1)).toBeCloseTo(0.02);
    expect(calculateRequestCost("ticker-returns", undefined, undefined, undefined, 2)).toBeCloseTo(0.03);
    expect(calculateRequestCost("ticker-returns", undefined, undefined, undefined, 15)).toBeCloseTo(0.16);
    expect(calculateRequestCost("ticker-returns", undefined, undefined, undefined, 99)).toBeCloseTo(0.16);
  });

  it("restores the advertised 25% batch-lstar discount (R5)", () => {
    const single = calculateRequestCost("lstar", undefined, undefined, undefined, 1);
    const batchFour = calculateRequestCost("batch-lstar", undefined, undefined, 4, 1);
    expect(single).toBeCloseTo(0.02);
    expect(batchFour).toBeCloseTo(0.06);
    expect(batchFour / (single * 4)).toBeCloseTo(0.75);
  });

  it("does not let batch-lstar undercut raw ticker-returns (R2)", () => {
    const raw1y = calculateRequestCost("ticker-returns", undefined, undefined, undefined, 1);
    const batchLstarTen = calculateRequestCost("batch-lstar", undefined, undefined, 10, 1);
    expect(batchLstarTen / 10).toBeCloseTo(0.015);
    expect(batchLstarTen / 10).toBeLessThan(raw1y);
    expect(batchLstarTen / 10).toBeGreaterThan(raw1y * 0.5);
  });

  it("applies the batch minimum at two positions", () => {
    expect(calculateRequestCost("batch-lstar", undefined, undefined, 1, 1)).toBeCloseTo(0.03);
    expect(calculateRequestCost("batch-analysis", undefined, undefined, 1)).toBeCloseTo(0.03);
  });

  it("moves hedge-basket to the decision tier (R1)", () => {
    const cap = getCapabilityById("hedge-basket");
    expect(cap?.pricing.tier).toBe("premium");
    expect(calculateRequestCost("hedge-basket")).toBeCloseTo(0.02);
  });

  it("holds residual-signal at $0.02", () => {
    expect(calculateRequestCost("residual-signal")).toBeCloseTo(0.02);
  });

  it("uses legacy rates when grandfathered", () => {
    expect(
      calculateRequestCost("ticker-returns", undefined, undefined, undefined, 15, true),
    ).toBeCloseTo(0.005);
    expect(calculateRequestCost("metrics", undefined, undefined, undefined, undefined, true)).toBeCloseTo(0.001);
    expect(calculateRequestCost("batch-lstar", undefined, undefined, 10, 5, true)).toBeCloseTo(0.05);
  });

  it("declares a grandfather window", () => {
    expect(PRICE_BOOK.effective).toBe("2026-08-14");
    expect(PRICE_BOOK.grandfather_until).toBe("2026-12-31");
  });
});
