import { describe, expect, it } from "vitest";
import { normalizeHedgeLevel } from "../normalize";

describe("normalizeHedgeLevel", () => {
  it("defaults missing level to L3", () => {
    expect(normalizeHedgeLevel(undefined)).toBe("L3");
    expect(normalizeHedgeLevel(null)).toBe("L3");
    expect(normalizeHedgeLevel("")).toBe("L3");
  });

  it("accepts L1/L2/L3 case-insensitively", () => {
    expect(normalizeHedgeLevel("l2")).toBe("L2");
    expect(normalizeHedgeLevel(" L3 ")).toBe("L3");
  });

  it("rejects invalid levels", () => {
    expect(() => normalizeHedgeLevel("L4")).toThrow(/expected L1, L2, or L3/);
    expect(() => normalizeHedgeLevel("market")).toThrow(/expected L1, L2, or L3/);
  });
});
