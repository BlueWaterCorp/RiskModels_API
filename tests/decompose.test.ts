import { describe, expect, it } from "vitest";
import { DecomposeRequestSchema } from "@/lib/api/schemas";

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
});

/**
 * Pure unit test of the hedge-map sign convention used in
 * app/api/decompose/route.ts: `hedge[etf] === -layer.hr`, with duplicate
 * ETFs across layers summed. The logic is small enough to inline-test
 * here without standing up a full DAL mock.
 */
describe("decompose hedge-map sign convention", () => {
  interface Layer {
    hr: number | null;
    hedge_etf: string | null;
  }

  function buildHedge(
    layers: Record<"market" | "sector" | "subsector", Layer>,
  ): Record<string, number> {
    const hedge: Record<string, number> = {};
    for (const name of ["market", "sector", "subsector"] as const) {
      const layer = layers[name];
      if (layer.hedge_etf && layer.hr !== null) {
        hedge[layer.hedge_etf] = (hedge[layer.hedge_etf] ?? 0) + -layer.hr;
      }
    }
    return hedge;
  }

  it("emits negative-of-HR per layer", () => {
    const hedge = buildHedge({
      market: { hr: 1.1, hedge_etf: "SPY" },
      sector: { hr: 0.35, hedge_etf: "XLK" },
      subsector: { hr: 0.6, hedge_etf: "SMH" },
    });
    expect(hedge.SPY).toBeCloseTo(-1.1, 6);
    expect(hedge.XLK).toBeCloseTo(-0.35, 6);
    expect(hedge.SMH).toBeCloseTo(-0.6, 6);
  });

  it("flips sign when HR is negative (long-ETF hedge leg)", () => {
    const hedge = buildHedge({
      market: { hr: -0.2, hedge_etf: "SPY" },
      sector: { hr: 0.1, hedge_etf: "XLF" },
      subsector: { hr: 0.0, hedge_etf: "KBE" },
    });
    expect(hedge.SPY).toBeCloseTo(0.2, 6);
    expect(hedge.XLF).toBeCloseTo(-0.1, 6);
    expect(hedge.KBE).toBeCloseTo(0.0, 6);
  });

  it("sums duplicate ETFs across layers (subsector falls back to sector ETF)", () => {
    const hedge = buildHedge({
      market: { hr: 1.0, hedge_etf: "SPY" },
      sector: { hr: 0.4, hedge_etf: "XLF" },
      subsector: { hr: 0.2, hedge_etf: "XLF" },
    });
    expect(hedge.SPY).toBeCloseTo(-1.0, 6);
    expect(hedge.XLF).toBeCloseTo(-0.6, 6);
    expect(Object.keys(hedge).sort()).toEqual(["SPY", "XLF"]);
  });

  it("skips layers with null HR or null ETF", () => {
    const hedge = buildHedge({
      market: { hr: 1.0, hedge_etf: "SPY" },
      sector: { hr: null, hedge_etf: "XLK" },
      subsector: { hr: 0.5, hedge_etf: null },
    });
    expect(hedge).toEqual({ SPY: -1.0 });
  });
});
