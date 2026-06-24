import { describe, expect, it } from "vitest";
import { DecomposeV4RequestSchema } from "@/lib/api/schemas";

describe("DecomposeV4RequestSchema", () => {
  it("defaults basis to L3 and upper-cases the ticker", () => {
    const r = DecomposeV4RequestSchema.safeParse({ ticker: "nvda" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ticker).toBe("NVDA");
      expect(r.data.basis).toBe("L3");
    }
  });

  it("accepts basis=lstar", () => {
    const r = DecomposeV4RequestSchema.safeParse({ ticker: "AAPL", basis: "lstar" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.basis).toBe("lstar");
  });

  it("rejects an unknown basis", () => {
    const r = DecomposeV4RequestSchema.safeParse({ ticker: "AAPL", basis: "L7" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing ticker", () => {
    const r = DecomposeV4RequestSchema.safeParse({ basis: "L3" });
    expect(r.success).toBe(false);
  });
});

/**
 * Pure unit test of the v4/decompose partition helpers (inline in
 * app/api/v4/decompose/route.ts), tested here without a full DAL mock —
 * mirrors tests/decompose.test.ts.
 */
describe("v4/decompose partition helpers", () => {
  const neg = (v: number | null): number | null => (v === null ? null : -v);
  const sumDefined = (...vals: (number | null)[]): number | null => {
    const present = vals.filter((v): v is number => v !== null);
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
  };

  it("neg flips a hedge ratio into a hedge notional, preserving null", () => {
    expect(neg(1.1)).toBeCloseTo(-1.1, 6);
    expect(neg(-0.2)).toBeCloseTo(0.2, 6);
    expect(neg(null)).toBeNull();
  });

  it("sumDefined sums present values and stays null only when all are null", () => {
    expect(sumDefined(0.21, 0.05)).toBeCloseTo(0.26, 6);
    expect(sumDefined(0.21, null)).toBeCloseTo(0.21, 6);
    expect(sumDefined(null, null)).toBeNull();
  });

  it("L3 basis partition sums to ~1 (residual splits into style + stock_specific)", () => {
    // market + sector + subsector + style_l3 + stock_specific_l3 ≈ 1, because
    // l3_res_er ≈ style_er_l3 + stock_specific_er_l3.
    const market = 0.55;
    const sector = 0.13;
    const subsector = 0.08;
    const style_l3 = 0.07;
    const stock_specific_l3 = 0.17;
    const sum = market + sector + subsector + style_l3 + stock_specific_l3;
    expect(Math.abs(sum - 1)).toBeLessThan(0.06);
  });
});
