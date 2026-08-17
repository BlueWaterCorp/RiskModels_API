import { describe, expect, it } from "vitest";

import { IndustryPanelRequestSchema } from "@/lib/api/schemas";

describe("IndustryPanelRequestSchema", () => {
  it("accepts optional teo, level, and min_peers", () => {
    const parsed = IndustryPanelRequestSchema.parse({
      market_factor_etf: "SPY",
      teo: "2026-05-22",
      level: "sector",
      min_peers: "10",
    });
    expect(parsed.teo).toBe("2026-05-22");
    expect(parsed.level).toBe("sector");
    expect(parsed.min_peers).toBe(10);
  });

  it("defaults by to level and accepts by=fact", () => {
    const parsed = IndustryPanelRequestSchema.parse({
      market_factor_etf: "SPY",
    });
    expect(parsed.by).toBe("level");
    const fact = IndustryPanelRequestSchema.parse({ by: "fact" });
    expect(fact.by).toBe("fact");
  });

  it("rejects invalid by", () => {
    const result = IndustryPanelRequestSchema.safeParse({ by: "industry" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid teo format", () => {
    const result = IndustryPanelRequestSchema.safeParse({
      teo: "05/22/2026",
    });
    expect(result.success).toBe(false);
  });
});
