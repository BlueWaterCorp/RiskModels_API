import { describe, expect, it } from "vitest";

import {
  aggregateFactsToLevel,
  factCellsToFactRows,
  factLevelToName,
  type IndustryPanelFactCell,
} from "@/lib/risk/industry-panel-aggregate";

function cell(
  partial: Partial<IndustryPanelFactCell> & Pick<IndustryPanelFactCell, "fact" | "beta_mean">,
): IndustryPanelFactCell {
  return {
    industry_code: 3520,
    level: "subsector",
    beta_variance: 0.04,
    n_companies: 10,
    total_log_mcap_weight: 100,
    ...partial,
  };
}

describe("factLevelToName", () => {
  it("maps 1/2/3 and drops style (4)", () => {
    expect(factLevelToName(1)).toBe("market");
    expect(factLevelToName(2)).toBe("sector");
    expect(factLevelToName(3)).toBe("subsector");
    expect(factLevelToName(4)).toBeNull();
    expect(factLevelToName(0)).toBeNull();
  });
});

describe("aggregateFactsToLevel", () => {
  it("is identity for a single-fact group", () => {
    const one = cell({ fact: "XRT", beta_mean: 1.1, beta_variance: 0.09, n_companies: 12 });
    expect(aggregateFactsToLevel([one])).toEqual([
      {
        industry_code: 3520,
        level: "subsector",
        beta_mean: 1.1,
        beta_variance: 0.09,
        n_companies: 12,
        total_log_mcap_weight: 100,
        n_facts: 1,
      },
    ]);
  });

  it("n-weights the mean and uses the law of total variance", () => {
    // Two equal-n groups: μ = 1.0, mixture var = E[τ²] + Var(μ) = 0.04 + 0.01 = 0.05
    const a = cell({ fact: "XLY", beta_mean: 0.9, beta_variance: 0.04, n_companies: 20, total_log_mcap_weight: 40 });
    const b = cell({ fact: "XLP", beta_mean: 1.1, beta_variance: 0.04, n_companies: 20, total_log_mcap_weight: 60 });
    const [row] = aggregateFactsToLevel([a, b]);
    expect(row?.n_facts).toBe(2);
    expect(row?.n_companies).toBe(40);
    expect(row?.beta_mean).toBeCloseTo(1.0, 12);
    expect(row?.beta_variance).toBeCloseTo(0.05, 12);
    expect(row?.total_log_mcap_weight).toBe(100);
  });

  it("weights by n_companies, not equally across facts", () => {
    const thin = cell({ fact: "XRT", beta_mean: 2.0, n_companies: 5, total_log_mcap_weight: 10 });
    const thick = cell({ fact: "XLY", beta_mean: 1.0, n_companies: 15, total_log_mcap_weight: 30 });
    const [row] = aggregateFactsToLevel([thin, thick]);
    expect(row?.beta_mean).toBeCloseTo((2 * 5 + 1 * 15) / 20, 12);
    expect(row?.n_companies).toBe(20);
  });

  it("nulls variance when any contributing fact is missing τ²", () => {
    const a = cell({ fact: "XLY", beta_mean: 1.0, beta_variance: 0.04 });
    const b = cell({ fact: "XLP", beta_mean: 1.2, beta_variance: null });
    const [row] = aggregateFactsToLevel([a, b]);
    expect(row?.beta_variance).toBeNull();
    expect(row?.n_facts).toBe(2);
  });

  it("keeps (industry, level) groups separate", () => {
    const l3 = cell({ fact: "XRT", beta_mean: 1.0, level: "subsector", industry_code: 3520 });
    const l2 = cell({ fact: "XLP", beta_mean: 0.5, level: "sector", industry_code: 3520 });
    const other = cell({ fact: "SOXX", beta_mean: 1.4, level: "subsector", industry_code: 4530 });
    const rows = aggregateFactsToLevel([l3, l2, other]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.industry_code, r.level, r.n_facts])).toEqual([
      [3520, "sector", 1],
      [3520, "subsector", 1],
      [4530, "subsector", 1],
    ]);
  });
});

describe("factCellsToFactRows", () => {
  it("preserves fact and sorts by level, industry, fact", () => {
    const rows = factCellsToFactRows([
      cell({ fact: "XLP", beta_mean: 1.0, industry_code: 3520 }),
      cell({ fact: "XLY", beta_mean: 0.8, industry_code: 3520 }),
    ]);
    expect(rows.map((r) => r.fact)).toEqual(["XLP", "XLY"]);
    expect(rows[0]?.fact).toBe("XLP");
    expect(rows[0]).not.toHaveProperty("n_facts");
  });
});

describe("historical L3 fixture (teo 2021-06-22, industry 4850)", () => {
  it("collapses IAI+IYG with IAI sitting on the min_peers floor", () => {
    const iai = cell({
      industry_code: 4850,
      fact: "IAI",
      beta_mean: 0.375983,
      beta_variance: 0.02730514109134674,
      n_companies: 5,
      total_log_mcap_weight: 10,
    });
    const iyg = cell({
      industry_code: 4850,
      fact: "IYG",
      beta_mean: 0.752238,
      beta_variance: 0.9026185870170593,
      n_companies: 17,
      total_log_mcap_weight: 40,
    });
    const [row] = aggregateFactsToLevel([iai, iyg]);
    expect(row?.n_facts).toBe(2);
    expect(row?.n_companies).toBe(22);
    expect(row?.beta_mean).toBeCloseTo((0.375983 * 5 + 0.752238 * 17) / 22, 6);
  });
});
