import { describe, expect, it } from "vitest";
import {
  buildFundamentalsRows,
  buildSensitivityGrid,
  costOfDebt,
  costOfEquity,
  DEFAULT_ERP_GRID,
  economicProfit,
  latestFinite,
  roeTtm,
  SEC_DEBT_COMPLETENESS_FLOOR,
  selectPitIndices,
  trustSecDebt,
  ttmAvg,
  ttmSum,
  waccBookWeights,
  type FundamentalsRowPack,
} from "@/lib/dal/fundamentals-zarr-reader";

/**
 * Synthetic single-symbol store pack: 6 quarters, the newest of which is filed
 * AFTER the PIT gate used in most tests (2026-01-15). Values are round numbers
 * so TTM aggregates are hand-checkable.
 */
function syntheticPack(): FundamentalsRowPack {
  const n = 6;
  const fill = (v: (number | null)[]) => v;
  return {
    ticker: "TEST",
    periodEndDates: [
      "2024-09-30",
      "2024-12-31",
      "2025-03-31",
      "2025-06-30",
      "2025-09-30",
      "2025-12-31",
    ],
    // Newest quarter filed 2026-01-30 — invisible at as_of=2026-01-15.
    // First column never filed (null): must be excluded regardless of as_of.
    filedDates: [null, "2025-01-31", "2025-05-02", "2025-08-01", "2025-10-31", "2026-01-30"],
    filedDateSource: [null, 1, 1, 1, 2, 1],
    vars: {
      revenue: fill([100, 100, 100, 100, 100, 120]),
      net_income: fill([10, 10, 10, 10, 10, 20]),
      total_assets: fill([400, 400, 400, 400, 400, 500]),
      total_equity: fill([100, 100, 100, 100, 100, 200]),
      total_debt: fill([50, 50, 50, 50, 50, 60]),
      cash_from_operations: fill([20, 20, 20, 20, 20, 30]),
      capital_expenditures: fill([5, 5, 5, 5, 5, 5]),
      interest_expense: fill([1, 1, 1, 1, 1, 1]),
      beta_market: fill([1.0, 1.0, 1.0, 1.0, 1.2, 1.1]),
      beta_sector: fill([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
      beta_subsector: fill([0.2, 0.2, 0.2, 0.2, 0.2, 0.2]),
      beta_source: fill([1, 1, 1, 1, 1, 1]),
    },
    // SEC-fact planes (Phase 1+2). dividends_paid + share_repurchases feed the capital-return
    // ratios; source planes drive per-cell gating. Only the newest quarter is SEC-served here so
    // the ratios have flows and the gate has a positive case.
    secRaw: {
      dividends_paid: fill([2, 2, 2, 2, 2, 3]),
      share_repurchases: fill([4, 4, 4, 4, 4, 5]),
      revenue: fill([100, 100, 100, 100, 100, 120]),
      // H.89.12: Kd / WACC / leverage read total_debt_sec (SEC recipe), not EODHD total_debt
      total_debt_sec: fill([50, 50, 50, 50, 50, 60]),
    } as FundamentalsRowPack["secRaw"],
    secSource: {
      dividends_paid: fill([1, 1, 1, 1, 2, 2]),
      share_repurchases: fill([1, 1, 1, 1, 2, 2]),
      revenue: fill([1, 1, 1, 1, 2, 2]),
      total_debt_sec: fill([2, 2, 2, 2, 2, 2]),
    } as FundamentalsRowPack["secSource"],
    // equity bridge (Phase 3): residual null on the first period, mask 83 (net_income +
    // accumulated_oci + share_repurchases + share_based_comp) on the newest.
    bridgeResidual: fill([null, -5, -5, -5, -5, -7]),
    bridgeInputs: fill([0, 83, 83, 83, 83, 83]),
    // rf is a 1-D per-tenor strip on the period axis (2026-07-06 store revision);
    // 3m deliberately different so tenor selection is observable.
    rfCurve: {
      "10y": fill([0.04, 0.04, 0.04, 0.04, 0.04, 0.04]),
      "3m": fill([0.03, 0.03, 0.03, 0.03, 0.03, 0.03]),
    },
    // satisfies the interface exactly
  } as FundamentalsRowPack;
}

const OPTS = { asOf: "2026-01-15", periods: 8, erp: 0.05, taxRate: 0.21 };

describe("PIT visibility (filed_date <= as_of) — the load-bearing correctness requirement", () => {
  it("a row filed after as_of is invisible", () => {
    const pack = syntheticPack();
    const rows = buildFundamentalsRows(pack, OPTS);
    const periodEnds = rows.map((r) => r.period_end_date);
    // 2025-12-31 exists in the store but was filed 2026-01-30 > 2026-01-15.
    expect(periodEnds).not.toContain("2025-12-31");
    expect(periodEnds[periodEnds.length - 1]).toBe("2025-09-30");
  });

  it("the same row becomes visible once as_of reaches its filed_date", () => {
    const pack = syntheticPack();
    const rows = buildFundamentalsRows(pack, { ...OPTS, asOf: "2026-01-30" });
    expect(rows.map((r) => r.period_end_date)).toContain("2025-12-31");
  });

  it("a never-filed column (filed_date null/NaT) is excluded at any as_of", () => {
    const pack = syntheticPack();
    const idx = selectPitIndices(pack, "2099-12-31");
    expect(idx).not.toContain(0); // 2024-09-30 never filed
    const rows = buildFundamentalsRows(pack, { ...OPTS, asOf: "2099-12-31" });
    expect(rows.map((r) => r.period_end_date)).not.toContain("2024-09-30");
  });

  it("as_of before the first filing yields zero rows", () => {
    const rows = buildFundamentalsRows(syntheticPack(), { ...OPTS, asOf: "2024-01-01" });
    expect(rows).toHaveLength(0);
  });

  it("periods caps the returned rows to the most recent quarters", () => {
    const rows = buildFundamentalsRows(syntheticPack(), { ...OPTS, periods: 2 });
    expect(rows.map((r) => r.period_end_date)).toEqual(["2025-06-30", "2025-09-30"]);
  });
});

describe("TTM conventions (flow sum / stock avg-latest, 4 finite quarters required)", () => {
  it("ttmSum sums the last 4 finite flow values and NaNs below the floor", () => {
    expect(ttmSum([1, 2, 3, 4, 5])).toBe(2 + 3 + 4 + 5);
    expect(ttmSum([1, 2, 3])).toBeNaN();
  });

  it("ttmSum skips non-finite values when assembling the window", () => {
    // finite values are 1, 2, 3, 4 → exactly 4 → sum = 10
    expect(ttmSum([1, null, 2, NaN, 3, 4])).toBe(10);
    expect(ttmSum([null, 1, 2, 3, 4])).toBe(10);
    // only 3 finite → below the floor
    expect(ttmSum([null, 1, NaN, 2, 3])).toBeNaN();
  });

  it("ttmAvg averages the last 4 finite stock values", () => {
    expect(ttmAvg([100, 100, 100, 100, 200])).toBe((100 + 100 + 100 + 200) / 4);
    expect(ttmAvg([100, 100, 100])).toBeNaN();
  });

  it("latestFinite takes the most recent finite value", () => {
    expect(latestFinite([1, 2, null, NaN])).toBe(2);
    expect(latestFinite([null, NaN])).toBeNaN();
  });

  it("derived row ratios match hand computation on the synthetic pack", () => {
    const rows = buildFundamentalsRows(syntheticPack(), OPTS);
    const last = rows[rows.length - 1]!; // 2025-09-30, window = 4 visible quarters
    // roe_ttm = 40 / 100; roa_ttm = 40 / 400; leverage = 50/100; fcf_margin = (80-20)/400
    expect(last.roe_ttm).toBeCloseTo(0.4, 10);
    expect(last.roa_ttm).toBeCloseTo(0.1, 10);
    expect(last.leverage_ratio).toBeCloseTo(0.5, 10);
    expect(last.fcf_margin).toBeCloseTo(60 / 400, 10);
    // cost_of_equity = 0.04 + 1.2 * 0.05 (row anchor beta = 1.2)
    expect(last.cost_of_equity).toBeCloseTo(0.1, 10);
    // cost_of_debt = 4 / 50
    expect(last.cost_of_debt).toBeCloseTo(0.08, 10);
    // economic_profit = (0.4 - 0.1) * 100
    expect(last.economic_profit).toBeCloseTo(30, 10);
    // wacc book weights: E=100 D=50 → (100/150)*0.1 + (50/150)*0.08*(1-0.21)
    expect(last.wacc).toBeCloseTo((100 / 150) * 0.1 + (50 / 150) * 0.08 * 0.79, 10);
    // margins pending store inputs
    expect(last.gross_margin).toBeNull();
    expect(last.operating_margin).toBeNull();
    expect(last.beta_source).toBe("in-universe");
    expect(last.filed_date_source).toBe("approx");
  });

  it("early rows with fewer than 4 visible trailing quarters have null TTM ratios", () => {
    const rows = buildFundamentalsRows(syntheticPack(), OPTS);
    const first = rows[0]!; // 2024-12-31 — only 1 visible quarter in its window
    expect(first.roe_ttm).toBeNull();
    expect(first.fcf_margin).toBeNull();
    expect(first.cost_of_debt).toBeNull();
    // but the point-in-time cost of equity still computes (rf + beta*erp)
    expect(first.cost_of_equity).toBeCloseTo(0.04 + 1.0 * 0.05, 10);
  });
});

describe("guards — equity <= 0, debt <= 0, missing betas (NaN, never clip)", () => {
  it("cost_of_debt guards debt <= 0 and non-positive interest", () => {
    expect(costOfDebt(4, 0)).toBeNaN();
    expect(costOfDebt(4, -10)).toBeNaN();
    expect(costOfDebt(NaN, 50)).toBeNaN();
    expect(costOfDebt(0, 50)).toBeNaN();
    expect(costOfDebt(-1, 50)).toBeNaN();
    expect(costOfDebt(4, 50)).toBeCloseTo(0.08, 10);
  });

  it("roe_ttm and economic_profit guard equity <= 0", () => {
    expect(roeTtm(40, 0)).toBeNaN();
    expect(roeTtm(40, -5)).toBeNaN();
    expect(economicProfit(40, 100, 0, 0.04, 1.0)).toBeNaN();
    expect(economicProfit(40, 100, -1, 0.04, 1.0)).toBeNaN();
  });

  it("cost_of_equity requires finite rf and beta", () => {
    expect(costOfEquity(NaN, 1.0)).toBeNaN();
    expect(costOfEquity(0.04, NaN)).toBeNaN();
  });

  it("conditional beta: negative beta pushes cost_of_equity below rf — allowed, never clipped", () => {
    const coe = costOfEquity(0.04, -0.29, 0.05);
    expect(coe).toBeCloseTo(0.0255, 10);
    expect(coe).toBeLessThan(0.04);
  });

  it("wacc collapses to equity-only when there is no positive debt", () => {
    // no-debt firm: kd is NaN, w_d = 0 → ke
    expect(waccBookWeights(0.04, 1.0, NaN, 100, 0, 0.21)).toBeCloseTo(0.09, 10);
    // positive debt but missing interest → NaN (never understate as wE*ke)
    expect(waccBookWeights(0.04, 1.0, NaN, 100, 50, 0.21)).toBeNaN();
    // negative total capital → NaN
    expect(waccBookWeights(0.04, 1.0, 4, -100, 0, 0.21)).toBeNaN();
    // missing beta → NaN even with clean legs
    expect(waccBookWeights(0.04, NaN, 4, 100, 50, 0.21)).toBeNaN();
  });

  it("rows surface guard NaNs as nulls (equity<=0, debt<=0, missing betas)", () => {
    const pack = syntheticPack();
    pack.vars.total_equity = [-10, -10, -10, -10, -10, -10];
    pack.vars.total_debt = [0, 0, 0, 0, 0, 0];
    pack.secRaw.total_debt_sec = [0, 0, 0, 0, 0, 0];
    pack.vars.beta_market = [null, null, null, null, null, null];
    const rows = buildFundamentalsRows(pack, OPTS);
    const last = rows[rows.length - 1]!;
    expect(last.roe_ttm).toBeNull();
    expect(last.leverage_ratio).toBeNull();
    expect(last.cost_of_debt).toBeNull();
    expect(last.cost_of_equity).toBeNull();
    expect(last.wacc).toBeNull();
    expect(last.economic_profit).toBeNull();
    expect(last.beta_market).toBeNull();
  });

  it("trustSecDebt refuses when SEC sits below the completeness floor vs EODHD", () => {
    expect(trustSecDebt(50, 50)).toBe(50);
    expect(trustSecDebt(45, 50)).toBe(45); // 0.90 exactly — allowed
    expect(trustSecDebt(44, 50)).toBeNaN(); // below floor
    expect(trustSecDebt(20, 1000)).toBeNaN(); // the measured under-capture tail
    // No EODHD counterpart → cannot cross-check; SEC recipe alone
    expect(trustSecDebt(50, NaN)).toBe(50);
    expect(trustSecDebt(50, 0)).toBe(50);
    expect(SEC_DEBT_COMPLETENESS_FLOOR).toBe(0.9);
  });

  it("rows refuse leverage/Kd/WACC when the SEC debt recipe under-captured", () => {
    const pack = syntheticPack();
    // EODHD borrowings stay at 50; SEC recipe reports a partial sum (~0.1×)
    pack.secRaw.total_debt_sec = [5, 5, 5, 5, 5, 5];
    const rows = buildFundamentalsRows(pack, OPTS);
    const last = rows[rows.length - 1]!;
    expect(last.leverage_ratio).toBeNull();
    expect(last.cost_of_debt).toBeNull();
    expect(last.wacc).toBeNull();
    // Equity-side metrics still compute
    expect(last.roe_ttm).toBeCloseTo(0.4, 10);
    expect(last.cost_of_equity).toBeCloseTo(0.1, 10);
  });
});

describe("rf tenor strip (2026-07-06 store revision)", () => {
  it("default tenor is 10y", () => {
    const rows = buildFundamentalsRows(syntheticPack(), OPTS);
    expect(rows[rows.length - 1]!.rf_rate).toBeCloseTo(0.04, 10);
  });

  it("rf_tenor selects the requested strip and flows into cost_of_equity", () => {
    const rows = buildFundamentalsRows(syntheticPack(), { ...OPTS, rfTenor: "3m" });
    const last = rows[rows.length - 1]!;
    expect(last.rf_rate).toBeCloseTo(0.03, 10);
    // anchor beta at 2025-09-30 = 1.2 → CoE = 0.03 + 1.2 * 0.05
    expect(last.cost_of_equity).toBeCloseTo(0.09, 10);
  });

  it("a tenor absent from the store yields null rf and null cost of capital — never a wrong-tenor substitute", () => {
    const rows = buildFundamentalsRows(syntheticPack(), { ...OPTS, rfTenor: "30y" });
    const last = rows[rows.length - 1]!;
    expect(last.rf_rate).toBeNull();
    expect(last.cost_of_equity).toBeNull();
    expect(last.wacc).toBeNull();
    expect(last.economic_profit).toBeNull();
    // non-rf fields unaffected
    expect(last.beta_market).not.toBeNull();
    expect(last.roe_ttm).not.toBeNull();
  });
});

describe("sensitivity grid (H.89.6) — erp x rf_tenor cost-of-capital grid", () => {
  const GRID_OPTS = {
    asOf: "2026-01-15",
    erpGrid: DEFAULT_ERP_GRID,
    rfTenorGrid: ["3m", "10y"] as const,
    taxRate: 0.21,
  };

  it("anchors on the same latest PIT-visible period as buildFundamentalsRows", () => {
    const grid = buildSensitivityGrid(syntheticPack(), GRID_OPTS)!;
    expect(grid.period_end_date).toBe("2025-09-30");
    expect(grid.filed_date).toBe("2025-10-31");
  });

  it("cells is row-major [erp][tenor] and matches costOfEquity for each combination", () => {
    const grid = buildSensitivityGrid(syntheticPack(), GRID_OPTS)!;
    expect(grid.erp_values).toEqual([...DEFAULT_ERP_GRID]);
    expect(grid.rf_tenor_values).toEqual(["3m", "10y"]);
    expect(grid.cells).toHaveLength(DEFAULT_ERP_GRID.length);
    // anchor beta_market at 2025-09-30 = 1.2 (same anchor as the rf-tenor describe block above)
    DEFAULT_ERP_GRID.forEach((erp, i) => {
      expect(grid.cells[i]).toHaveLength(2);
      expect(grid.cells[i]![0]!.cost_of_equity).toBeCloseTo(costOfEquity(0.03, 1.2, erp), 10);
      expect(grid.cells[i]![1]!.cost_of_equity).toBeCloseTo(costOfEquity(0.04, 1.2, erp), 10);
    });
  });

  it("a tenor absent from the store yields null cells for that column only", () => {
    const grid = buildSensitivityGrid(syntheticPack(), {
      ...GRID_OPTS,
      rfTenorGrid: ["3m", "30y"] as const,
    })!;
    grid.cells.forEach((row) => {
      expect(row[0]!.cost_of_equity).not.toBeNull();
      expect(row[1]!.cost_of_equity).toBeNull();
      expect(row[1]!.wacc).toBeNull();
      expect(row[1]!.economic_profit).toBeNull();
    });
  });

  it("returns null when no PIT-visible period exists at as_of", () => {
    const grid = buildSensitivityGrid(syntheticPack(), { ...GRID_OPTS, asOf: "2024-01-01" });
    expect(grid).toBeNull();
  });
});
