import { describe, expect, it } from "vitest";
import { billableCostUsd } from "@/lib/agent/billable-cost";
import { calculateEstimatedCost } from "@/lib/agent/capabilities";

const CAP = "batch-analysis";

describe("billableCostUsd", () => {
  const preflight100 = calculateEstimatedCost(CAP, { itemCount: 100 });

  it("bills only the items that returned data", () => {
    const cost = billableCostUsd({ capabilityId: CAP, preflightCostUsd: preflight100, billableItems: 87 });
    expect(cost).toBeCloseTo(calculateEstimatedCost(CAP, { itemCount: 87 }), 10);
    expect(cost).toBeLessThan(preflight100);
  });

  it("charges nothing when every item failed, even with a per-call minimum", () => {
    expect(billableCostUsd({ capabilityId: CAP, preflightCostUsd: preflight100, billableItems: 0 })).toBe(0);
  });

  it("keeps the per-call minimum when at least one item succeeded", () => {
    expect(billableCostUsd({ capabilityId: CAP, preflightCostUsd: preflight100, billableItems: 1 })).toBeCloseTo(
      calculateEstimatedCost(CAP, { itemCount: 1 }),
      10,
    );
  });

  it("never rises above the pre-flight estimate", () => {
    expect(billableCostUsd({ capabilityId: CAP, preflightCostUsd: 0.05, billableItems: 100 })).toBe(0.05);
    expect(billableCostUsd({ capabilityId: CAP, preflightCostUsd: 0, billableItems: 10 })).toBe(0);
  });

  it("treats non-finite or negative counts as zero", () => {
    expect(billableCostUsd({ capabilityId: CAP, preflightCostUsd: preflight100, billableItems: Number.NaN })).toBe(0);
    expect(billableCostUsd({ capabilityId: CAP, preflightCostUsd: preflight100, billableItems: -3 })).toBe(0);
  });
});

describe("portfolio-exposure size tiers", () => {
  const CAP2 = "portfolio-exposure";
  const price = (n: number) => calculateEstimatedCost(CAP2, { itemCount: n });

  it("charges $0.25 up to 25 names and $1.00 above", () => {
    expect(price(1)).toBe(0.25);
    expect(price(25)).toBe(0.25);
    expect(price(26)).toBe(1.0);
    expect(price(1000)).toBe(1.0);
  });

  it("drops to the lower tier when fewer names are modelled than submitted", () => {
    // 30 submitted (pre-flight $1.00), 24 modelled.
    expect(billableCostUsd({ capabilityId: CAP2, preflightCostUsd: price(30), billableItems: 24 })).toBe(0.25);
    expect(billableCostUsd({ capabilityId: CAP2, preflightCostUsd: price(30), billableItems: 30 })).toBe(1.0);
  });

  it("never charges the higher tier when the pre-flight estimate was the lower one", () => {
    expect(billableCostUsd({ capabilityId: CAP2, preflightCostUsd: price(10), billableItems: 40 })).toBe(0.25);
  });
});

describe("estimate for /portfolio/exposure", () => {
  it("quotes the size tier from the submitted positions", async () => {
    const { estimateCost } = await import("@/lib/agent/cost-estimator");
    const pos = (n: number) => Array.from({ length: n }, (_, i) => ({ ticker: `T${i}`, value: 1 }));
    expect((await estimateCost({ endpoint: "portfolio-exposure", params: { positions: pos(10) } }))?.estimated_cost_usd).toBe(0.25);
    const big = await estimateCost({ endpoint: "portfolio/exposure", params: { positions: pos(490) } });
    expect(big?.estimated_cost_usd).toBe(1.0);
    expect(big?.size_tiers).toEqual([{ min_items: 26, cost_usd: 1.0 }]);
  });
});
