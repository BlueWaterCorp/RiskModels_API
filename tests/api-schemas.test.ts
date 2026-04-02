import { describe, expect, it } from "vitest";
import { FactorCorrelationRequestSchema } from "@/lib/api/schemas";
import { parseMacroFactorsSeriesQuery } from "@/lib/api/macro-factors-series-query";

describe("FactorCorrelationRequestSchema", () => {
  it("accepts a valid single-ticker body", () => {
    const r = FactorCorrelationRequestSchema.safeParse({
      ticker: "AAPL",
      return_type: "l1",
      factors: ["bitcoin"],
      window_days: 126,
      method: "spearman",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ticker).toBe("AAPL");
      expect(r.data.return_type).toBe("l1");
      expect(r.data.factors).toEqual(["bitcoin"]);
    }
  });

  it("rejects invalid return_type", () => {
    const r = FactorCorrelationRequestSchema.safeParse({
      ticker: "NVDA",
      return_type: "l4",
    });
    expect(r.success).toBe(false);
  });

  it("rejects batch ticker list over 50", () => {
    const tickers = Array.from({ length: 51 }, (_, i) => `T${i}`);
    const r = FactorCorrelationRequestSchema.safeParse({ ticker: tickers });
    expect(r.success).toBe(false);
  });

  it("rejects window_days below minimum", () => {
    const r = FactorCorrelationRequestSchema.safeParse({
      ticker: "XOM",
      window_days: 10,
    });
    expect(r.success).toBe(false);
  });
});

describe("parseMacroFactorsSeriesQuery", () => {
  it("defaults range and factors when params empty", () => {
    const sp = new URLSearchParams();
    const r = parseMacroFactorsSeriesQuery(sp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.factorStrings.length).toBe(6);
      expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.start <= r.end).toBe(true);
    }
  });

  it("returns error when start is after end", () => {
    const sp = new URLSearchParams();
    sp.set("start", "2020-01-02");
    sp.set("end", "2020-01-01");
    const r = parseMacroFactorsSeriesQuery(sp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("start");
  });

  it("accepts factor synonym query param", () => {
    const sp = new URLSearchParams();
    sp.set("factor", "btc,vix");
    const r = parseMacroFactorsSeriesQuery(sp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.factorStrings).toContain("bitcoin");
      expect(r.factorStrings).toContain("vix");
    }
  });
});
