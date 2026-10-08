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
