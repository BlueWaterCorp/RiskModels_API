import { describe, expect, it } from "vitest";
import { macroFactorCachePayloadHasData } from "@/lib/risk/factor-correlation-service";

describe("macroFactorCachePayloadHasData", () => {
  it("is false for null, undefined, {}, and arrays", () => {
    expect(macroFactorCachePayloadHasData(null)).toBe(false);
    expect(macroFactorCachePayloadHasData(undefined)).toBe(false);
    expect(macroFactorCachePayloadHasData({})).toBe(false);
    expect(macroFactorCachePayloadHasData([] as unknown as Record<string, Record<string, number>>)).toBe(
      false,
    );
  });

  it("is true when at least one factor key is present", () => {
    expect(macroFactorCachePayloadHasData({ vix: { "2024-01-02": 0.01 } })).toBe(true);
  });
});
