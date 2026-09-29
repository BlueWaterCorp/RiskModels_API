import { describe, expect, it } from "vitest";
import { DecomposeRequestSchema } from "@/lib/api/schemas";
import { buildHedgeMap } from "@/lib/api/hedge-map";

describe("DecomposeRequestSchema", () => {
  it("accepts a valid ticker and upper-cases it", () => {
    const r = DecomposeRequestSchema.safeParse({ ticker: "nvda" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ticker).toBe("NVDA");
    }
  });

  it("trims whitespace", () => {
    const r = DecomposeRequestSchema.safeParse({ ticker: "  aapl  " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ticker).toBe("AAPL");
    }
  });

  it("rejects empty ticker", () => {
    const r = DecomposeRequestSchema.safeParse({ ticker: "" });
    expect(r.success).toBe(false);
  });

  it("rejects missing ticker", () => {
    const r = DecomposeRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects ticker longer than 12 chars", () => {
    const r = DecomposeRequestSchema.safeParse({ ticker: "X".repeat(13) });
    expect(r.success).toBe(false);
  });

  it("accepts an optional as_of date (G.42 historical read)", () => {
    const r = DecomposeRequestSchema.safeParse({
      ticker: "NVDA",
      as_of: "2025-06-30",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.as_of).toBe("2025-06-30");
    }
  });

  it("leaves as_of undefined when omitted (fast path)", () => {
    const r = DecomposeRequestSchema.safeParse({ ticker: "NVDA" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.as_of).toBeUndefined();
    }
  });

  it("rejects malformed as_of", () => {
    for (const bad of ["last-week", "2025-6-30", "20250630", "2025/06/30"]) {
      const r = DecomposeRequestSchema.safeParse({ ticker: "NVDA", as_of: bad });
      expect(r.success).toBe(false);
    }
  });
});

/**
 * Hedge-map sign convention (lib/api/hedge-map.ts, used by /decompose and
 * /landing/decompose): a layer HR is the ETF dollar position per $1 long stock,
 * negative = short, and `hedge[etf]` is that HR summed across shared ETFs.
 * 2026-09-29: the routes emitted -HR, which told a long NVDA holder to buy SPY.
 */
describe("decompose hedge-map sign convention", () => {
  it("a positive-beta stock (negative stored HR) maps to short ETF notionals", () => {
    // NVDA, 2026-09-28 production row: beta to SPY ~ +1.9, stored HRs negative.
    const hedge = buildHedgeMap({
      market: { hr: -0.588, hedge_etf: "SPY" },
      sector: { hr: -0.002, hedge_etf: "XLK" },
      subsector: { hr: -0.535, hedge_etf: "SMH" },
    });
    expect(hedge.SPY).toBeLessThan(0);
    expect(hedge.SMH).toBeLessThan(0);
    expect(hedge.SPY).toBeCloseTo(-0.588, 6);
  });

  it("a positive HR is a long ETF leg and stays positive", () => {
    const hedge = buildHedgeMap({
      market: { hr: 0.243, hedge_etf: "SPY" },
      sector: { hr: -0.744, hedge_etf: "XLP" },
      subsector: { hr: 0.0, hedge_etf: "PBJ" },
    });
    expect(hedge.SPY).toBeCloseTo(0.243, 6);
    expect(hedge.XLP).toBeCloseTo(-0.744, 6);
    expect(hedge.PBJ).toBeCloseTo(0.0, 6);
  });

  it("sums duplicate ETFs across layers (subsector falls back to sector ETF)", () => {
    const hedge = buildHedgeMap({
      market: { hr: -1.0, hedge_etf: "SPY" },
      sector: { hr: -0.4, hedge_etf: "XLF" },
      subsector: { hr: -0.2, hedge_etf: "XLF" },
    });
    expect(hedge.SPY).toBeCloseTo(-1.0, 6);
    expect(hedge.XLF).toBeCloseTo(-0.6, 6);
    expect(Object.keys(hedge).sort()).toEqual(["SPY", "XLF"]);
  });

  it("skips layers with null HR or null ETF, and the residual", () => {
    const hedge = buildHedgeMap({
      market: { hr: -1.0, hedge_etf: "SPY" },
      sector: { hr: null, hedge_etf: "XLK" },
      subsector: { hr: -0.5, hedge_etf: null },
      residual: { hr: null, hedge_etf: null },
    });
    expect(hedge).toEqual({ SPY: -1.0 });
  });
});
