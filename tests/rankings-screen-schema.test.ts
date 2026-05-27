import { describe, expect, it } from "vitest";

import { RankingsScreenRequestSchema } from "@/lib/api/schemas";
import { rankDecileFromPercentile } from "@/lib/dal/risk-engine-v3";

describe("RankingsScreenRequestSchema", () => {
  it("accepts percentile, decile, sector_filter, and as_of", () => {
    const parsed = RankingsScreenRequestSchema.parse({
      metric: "sector_residual",
      cohort: "universe",
      window: "252d",
      as_of: "2026-05-22",
      min_percentile: "90",
      decile: "1",
      sector_filter: "xlk",
      limit: "200",
    });
    expect(parsed.min_percentile).toBe(90);
    expect(parsed.decile).toBe(1);
    expect(parsed.sector_filter).toBe("xlk");
    expect(parsed.limit).toBe(200);
  });

  it("rejects invalid metric", () => {
    const result = RankingsScreenRequestSchema.safeParse({
      metric: "lstar_er",
      cohort: "universe",
      window: "1d",
    });
    expect(result.success).toBe(false);
  });
});

describe("rankDecileFromPercentile", () => {
  it("maps best percentiles to decile 1", () => {
    expect(rankDecileFromPercentile(100)).toBe(1);
    expect(rankDecileFromPercentile(91)).toBe(1);
    expect(rankDecileFromPercentile(90)).toBe(1);
  });

  it("maps mid percentiles to higher deciles", () => {
    expect(rankDecileFromPercentile(85)).toBe(2);
    expect(rankDecileFromPercentile(5)).toBe(10);
  });
});
