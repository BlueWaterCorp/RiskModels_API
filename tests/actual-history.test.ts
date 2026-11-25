import { describe, expect, it } from "vitest";
import {
  buildActualHistory,
  coverageHysteresis,
  parseActualHistoryWindow,
  type DailyReturnsCube,
} from "@/lib/portfolio/actual-history";

function cube(n: number, over: Partial<DailyReturnsCube> = {}): DailyReturnsCube {
  const teo = Array.from({ length: n }, (_, i) => `2020-01-${String(i + 1).padStart(2, "0")}`);
  const fill = (v: number | null) => Array.from({ length: n }, () => v);
  return {
    teo,
    gross_return: fill(0.01),
    l1_market: fill(0.006),
    l2_sector: fill(0.001),
    l3_subsector: fill(0.001),
    l3_residual: fill(0.002),
    style_return: null,
    weight_coverage: fill(1),
    mapping_coverage: fill(1),
    holding_report_date: teo.map(() => "2019-12-31"),
    ...over,
  };
}

describe("coverageHysteresis", () => {
  it("enters at 50%, holds in the band, exits below 10% or with no book", () => {
    expect(coverageHysteresis([0.3, 0.5, 0.3, 0.09, 0.3, 0.6, null, 0.6])).toEqual([
      false, true, true, false, false, true, false, true,
    ]);
  });
});

describe("buildActualHistory — filer", () => {
  it("starts at the first session with at least 50% of the book covered", () => {
    // mapping 0.8 × priced 0.5 = 0.40 (out), then 0.8 × 0.7 = 0.56 (in)
    const c = cube(5, {
      weight_coverage: [0.5, 0.5, 0.7, 0.7, 0.7],
      mapping_coverage: [0.8, 0.8, 0.8, 0.8, 0.8],
    });
    const h = buildActualHistory("filer", c)!;
    expect(h.history_kind).toBe("actual");
    expect(h.time_basis).toBe("period_of_report");
    expect(h.first_reliable_date).toBe("2020-01-03");
    expect(h.series.teo).toEqual(["2020-01-03", "2020-01-04", "2020-01-05"]);
    expect(h.series.coverage[0]).toBeCloseTo(0.56);
    expect(h.series.residual[0]).toBeCloseTo(0.002);
    expect(h.series.book_report_date?.[0]).toBe("2019-12-31");
  });

  it("nulls sessions below the exit threshold after the start and counts them", () => {
    const c = cube(4, { weight_coverage: [1, 0.05, 0.3, 0.9] });
    const h = buildActualHistory("filer", c)!;
    expect(h.series.gross).toEqual([0.01, null, null, 0.01]);
    expect(h.n_gap_periods).toBe(2);
  });

  it("returns null when no session clears the rule", () => {
    expect(buildActualHistory("filer", cube(3, { weight_coverage: [0.2, 0.3, 0.4] }))).toBeNull();
  });

  it("the window trims output without moving first_reliable_date", () => {
    const h = buildActualHistory("filer", cube(5), { startDate: "2020-01-03", endDate: "2020-01-04" })!;
    expect(h.first_reliable_date).toBe("2020-01-01");
    expect(h.series.teo).toEqual(["2020-01-03", "2020-01-04"]);
  });
});

describe("buildActualHistory — fund", () => {
  it("adds style into residual and uses the store's blanking as the mask", () => {
    const c = cube(4, {
      gross_return: [null, 0.01, 0.01, 0.01],
      l3_residual: [null, 0.0015, 0.0015, 0.0015],
      style_return: [null, 0.0005, 0.0005, 0.0005],
      weight_coverage: [0, 0.2, 0.9, 0.9],
      mapping_coverage: null,
      holding_report_date: null,
    });
    const h = buildActualHistory("fund", c)!;
    // Low priced share does not drop a session the fund mask kept.
    expect(h.first_reliable_date).toBe("2020-01-02");
    expect(h.series.residual[0]).toBeCloseTo(0.002);
    expect(h.series.book_report_date).toBeUndefined();
    const i = 0;
    const sum = h.series.market[i]! + h.series.sector[i]! + h.series.subsector[i]! + h.series.residual[i]!;
    expect(sum).toBeCloseTo(h.series.gross[i]!);
  });
});

describe("parseActualHistoryWindow", () => {
  it("rejects malformed and inverted windows", () => {
    expect(parseActualHistoryWindow(new URLSearchParams("start_date=2020-1-1")).ok).toBe(false);
    expect(parseActualHistoryWindow(new URLSearchParams("start_date=2021-01-01&end_date=2020-01-01")).ok).toBe(false);
    expect(parseActualHistoryWindow(new URLSearchParams("start_date=2020-01-01")).ok).toBe(true);
  });
});
