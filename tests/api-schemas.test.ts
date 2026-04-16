import { describe, expect, it } from "vitest";
import {
  FactorCorrelationRequestSchema,
  PortfolioRiskSnapshotRequestSchema,
} from "@/lib/api/schemas";
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

describe("PortfolioRiskSnapshotRequestSchema", () => {
  it("accepts minimal valid body and defaults format to json", () => {
    const r = PortfolioRiskSnapshotRequestSchema.safeParse({
      positions: [{ ticker: "NVDA", weight: 1 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.format).toBe("json");
      expect(r.data.positions).toHaveLength(1);
    }
  });

  it("accepts pdf with optional title and as_of_date", () => {
    const r = PortfolioRiskSnapshotRequestSchema.safeParse({
      positions: [
        { ticker: "AAPL", weight: 0.5 },
        { ticker: "MSFT", weight: 0.5 },
      ],
      format: "pdf",
      title: "Tech sleeve",
      as_of_date: "2026-01-15",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.format).toBe("pdf");
      expect(r.data.title).toBe("Tech sleeve");
      expect(r.data.as_of_date).toBe("2026-01-15");
    }
  });

  it("rejects invalid as_of_date", () => {
    const r = PortfolioRiskSnapshotRequestSchema.safeParse({
      positions: [{ ticker: "XOM", weight: 1 }],
      as_of_date: "01-15-2026",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty positions", () => {
    const r = PortfolioRiskSnapshotRequestSchema.safeParse({
      positions: [],
      format: "json",
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 100 positions", () => {
    const positions = Array.from({ length: 101 }, (_, i) => ({
      ticker: `T${i}`,
      weight: 1 / 101,
    }));
    const r = PortfolioRiskSnapshotRequestSchema.safeParse({ positions });
    expect(r.success).toBe(false);
  });
});

describe("parseMacroFactorsSeriesQuery", () => {
  it("defaults range and factors when params empty", () => {
    const sp = new URLSearchParams();
    const r = parseMacroFactorsSeriesQuery(sp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 10 canonical factors: inflation, term_spread, short_rates, credit,
      // oil, gold, usd, volatility, bitcoin, vix_spot
      expect(r.factorStrings.length).toBe(10);
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

  it("accepts factor synonym query param and normalizes legacy aliases", () => {
    const sp = new URLSearchParams();
    sp.set("factor", "btc,vix");
    const r = parseMacroFactorsSeriesQuery(sp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.factorStrings).toContain("bitcoin");
      // "vix" is a legacy v1 alias for the FRED-sourced spot VIX factor
      // (vs "volatility" which is the VXX futures-based factor).
      expect(r.factorStrings).toContain("vix_spot");
    }
  });
});
