/** Values are copied from the real filed-book row pinned in funds-holdings-route.test.ts. */
import { describe, expect, it } from "vitest";
import { normalizeFallbackHoldingRows } from "@/lib/dal/funds-zarr-reader";
import { summarizeHoldingValues } from "@/lib/plaid/holding-values";

describe("holding-value aggregate coverage", () => {
  it("preserves the complete-input sum", () => {
    const result = summarizeHoldingValues([
      { institution_value: 11_280_000_000 },
      { institution_value: 102_756_000_000 },
    ]);
    expect(result.total_value).toBe(114_036_000_000);
    expect(result.value_coverage).toBe(1);
    expect(result.data_quality_flags).toEqual([]);
  });

  it("excludes a missing row, reports coverage, and never turns all-missing into zero", () => {
    const partial = summarizeHoldingValues([
      { institution_value: 11_280_000_000 },
      { institution_value: null },
    ]);
    expect(partial.total_value).toBe(11_280_000_000);
    expect(partial.value_coverage).toBe(0.5);
    expect(partial.data_quality_flags).toEqual(["holding_value_coverage_incomplete"]);

    expect(summarizeHoldingValues([{ institution_value: null }]).total_value).toBeNull();
  });
});

describe("fallback holding-row coverage", () => {
  it("retains complete real values and excludes a missing value with a flag", () => {
    const result = normalizeFallbackHoldingRows([
      { symbol: "ROW_A", market_value_usd: 11_280_000_000, weight: 11_280_000_000 / 121_367_000_000 },
      { symbol: "ROW_B", market_value_usd: null, weight: null },
    ]);
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]!.adj_mv).toBe(11_280_000_000);
    expect(result.holding_value_coverage).toBe(0.5);
    expect(result.data_quality_flags).toEqual(["holding_value_coverage_incomplete"]);
  });
});
