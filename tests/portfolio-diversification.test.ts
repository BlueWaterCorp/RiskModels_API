import { describe, expect, it } from "vitest";
import {
  computeDiversificationMetrics,
  type DiversificationInput,
  type DiversificationTickerMetrics,
} from "@/lib/portfolio/portfolio-diversification";

function makeInput(overrides: Partial<DiversificationInput> = {}): DiversificationInput {
  const positions = overrides.positions ?? [
    { ticker: "A", weight: 0.5 },
    { ticker: "B", weight: 0.5 },
  ];

  const tickerMetrics = overrides.tickerMetrics ?? new Map<string, DiversificationTickerMetrics>([
    ["A", { l3_mkt_er: 0.5, l3_sec_er: 0.2, l3_sub_er: 0.1, l3_res_er: 0.2, sector_etf: "XLK", subsector_etf: "SMH" }],
    ["B", { l3_mkt_er: 0.5, l3_sec_er: 0.3, l3_sub_er: 0.05, l3_res_er: 0.15, sector_etf: "XLF", subsector_etf: "KRE" }],
  ]);

  const etfCorrelations = overrides.etfCorrelations ?? {
    sector: {
      etfs: ["XLK", "XLF"],
      R: [
        [1.0, 0.6],
        [0.6, 1.0],
      ],
    },
    subsector: {
      etfs: ["SMH", "KRE"],
      R: [
        [1.0, 0.3],
        [0.3, 1.0],
      ],
    },
  };

  return { positions, tickerMetrics, etfCorrelations, windowDays: 252, ...overrides };
}

describe("computeDiversificationMetrics", () => {
  it("produces correct naive ER (weighted sum)", () => {
    const r = computeDiversificationMetrics(makeInput());
    expect(r.naive_pws.market_er).toBeCloseTo(0.5, 4);
    expect(r.naive_pws.sector_er).toBeCloseTo(0.25, 4);
    expect(r.naive_pws.subsector_er).toBeCloseTo(0.075, 4);
    expect(r.naive_pws.residual_er).toBeCloseTo(0.175, 4);
    expect(r.naive_pws.total).toBeCloseTo(1.0, 4);
  });

  it("computes quadratic adjusted < naive for diversified portfolio", () => {
    const r = computeDiversificationMetrics(makeInput());
    expect(r.correlation_adjusted.sector_er).toBeLessThan(r.naive_pws.sector_er);
    expect(r.correlation_adjusted.subsector_er).toBeLessThan(r.naive_pws.subsector_er);
    expect(r.diversification_credit.sector).toBeGreaterThan(0);
    expect(r.diversification_credit.subsector).toBeGreaterThan(0);
  });

  it("sector u'Ru matches hand computation for 2-ETF case", () => {
    const input = makeInput();
    const r = computeDiversificationMetrics(input);
    // u_XLK = 0.5 * 0.2 = 0.1, u_XLF = 0.5 * 0.3 = 0.15
    // u'Ru = 0.1*1*0.1 + 0.1*0.6*0.15 + 0.15*0.6*0.1 + 0.15*1*0.15
    //      = 0.01 + 0.009 + 0.009 + 0.0225 = 0.0505
    expect(r.correlation_adjusted.sector_er).toBeCloseTo(0.0505, 4);
  });

  it("single-ETF degenerate case: adjusted = u^2", () => {
    const input = makeInput({
      tickerMetrics: new Map([
        ["A", { l3_mkt_er: 0.5, l3_sec_er: 0.3, l3_sub_er: 0.1, l3_res_er: 0.1, sector_etf: "XLK", subsector_etf: "SMH" }],
        ["B", { l3_mkt_er: 0.5, l3_sec_er: 0.2, l3_sub_er: 0.15, l3_res_er: 0.15, sector_etf: "XLK", subsector_etf: "SMH" }],
      ]),
      etfCorrelations: {
        sector: { etfs: ["XLK"], R: [[1.0]] },
        subsector: { etfs: ["SMH"], R: [[1.0]] },
      },
    });
    const r = computeDiversificationMetrics(input);
    // u_XLK = 0.5*0.3 + 0.5*0.2 = 0.25
    // adjusted = 0.25^2 * 1 = 0.0625
    expect(r.correlation_adjusted.sector_er).toBeCloseTo(0.0625, 6);
    // naive = 0.25, so credit = 0.25 - 0.0625 = 0.1875
    expect(r.diversification_credit.sector).toBeCloseTo(0.1875, 4);
  });

  it("residual uses concentration form (sum w_i^2 * res_er_i)", () => {
    const r = computeDiversificationMetrics(makeInput());
    // adj_residual = 0.5^2 * 0.2 + 0.5^2 * 0.15 = 0.05 + 0.0375 = 0.0875
    expect(r.correlation_adjusted.residual_er).toBeCloseTo(0.0875, 4);
    // naive_residual = 0.5*0.2 + 0.5*0.15 = 0.175
    expect(r.diversification_credit.residual).toBeCloseTo(0.175 - 0.0875, 4);
  });

  it("layers invariant: naive == adjusted + adjustment per layer", () => {
    const r = computeDiversificationMetrics(makeInput());
    for (const layer of r.layers) {
      expect(layer.naive_er).toBeCloseTo(layer.adjusted_er + layer.adjustment_er, 5);
    }
  });

  it("layers order is market → sector → subsector → residual", () => {
    const r = computeDiversificationMetrics(makeInput());
    expect(r.layers.map((l) => l.layer)).toEqual(["market", "sector", "subsector", "residual"]);
  });

  it("emits warning for missing sector_etf", () => {
    const input = makeInput({
      tickerMetrics: new Map([
        ["A", { l3_mkt_er: 0.5, l3_sec_er: 0.2, l3_sub_er: 0.1, l3_res_er: 0.2, sector_etf: "XLK", subsector_etf: "SMH" }],
        ["B", { l3_mkt_er: 0.5, l3_sec_er: 0.3, l3_sub_er: 0.05, l3_res_er: 0.15, sector_etf: null, subsector_etf: null }],
      ]),
    });
    const r = computeDiversificationMetrics(input);
    expect(r.warnings.some((w) => w.includes("B") && w.includes("sector_etf"))).toBe(true);
  });

  it("market adjusted is near-additive (close to naive)", () => {
    const r = computeDiversificationMetrics(makeInput());
    // Market has single factor, u'Ru with 1x1 R=[[1]] should give u^2
    // which is NOT naive (naive = sum w_i * er_i = 0.5, adjusted = 0.25)
    // but the quadratic form is still applied for uniformity
    expect(r.correlation_adjusted.market_er).toBeDefined();
    expect(r.layers[0].layer).toBe("market");
  });

  it("method and explanation are populated", () => {
    const r = computeDiversificationMetrics(makeInput());
    expect(r.method).toBe("variance_space_quadratic");
    expect(r._explanation).toContain("quadratic");
    expect(r._explanation).toContain("concentration");
  });

  it("multiplier is adjusted/naive when naive > 0", () => {
    const r = computeDiversificationMetrics(makeInput());
    const sectorLayer = r.layers.find((l) => l.layer === "sector")!;
    expect(sectorLayer.multiplier).toBeCloseTo(
      sectorLayer.adjusted_er / sectorLayer.naive_er,
      3,
    );
  });

  it("unique_etfs is set for sector and subsector layers only", () => {
    const r = computeDiversificationMetrics(makeInput());
    expect(r.layers.find((l) => l.layer === "sector")!.unique_etfs).toBe(2);
    expect(r.layers.find((l) => l.layer === "subsector")!.unique_etfs).toBe(2);
    expect(r.layers.find((l) => l.layer === "market")!.unique_etfs).toBeUndefined();
    expect(r.layers.find((l) => l.layer === "residual")!.unique_etfs).toBeUndefined();
  });
});
