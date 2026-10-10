import { describe, expect, it } from "vitest";

import {
  classifyFundBook,
  latestFiledColumn,
  totalBookColumn,
  type FundBookShape,
} from "@/lib/funds/long-short-guard";

// Book totals at the latest filed N-PORT column of each fund's ds_ph.zarr,
// read 2026-10-10 (USD; short_mv negative; nav = NET_ASSETS header).
const REAL: Record<string, FundBookShape & { rule: "R1" | null }> = {
  VMNFX: { teo: "2026-06-30", long_mv: 578631587.8, short_mv: -551804075.51, nav: 597170714.63, n_long: 313, n_short: 292, rule: "R1" },
  QMNNX: { teo: "2026-06-30", long_mv: 3660259380.56, short_mv: -3793337670.73, nav: 2873595075.1, n_long: 458, n_short: 516, rule: "R1" },
  NLSAX: { teo: "2026-07-31", long_mv: 5949364335.34, short_mv: -926635410.66, nav: 7337004439.19, n_long: 70, n_short: 64, rule: "R1" },
  DIAMX: { teo: "2026-03-31", long_mv: 1887010491.3, short_mv: -700162437.31, nav: 2187335888.5, n_long: 53, n_short: 43, rule: "R1" },
  // long-only control: Growth Fund of America
  AGTHX: { teo: "2026-02-28", long_mv: 266790417746.46, short_mv: 0, nav: 328047650672.35, n_long: 244, n_short: 0, rule: null },
};

describe("classifyFundBook on real funds", () => {
  for (const [tk, b] of Object.entries(REAL)) {
    it(`${tk} -> ${b.rule ?? "renders"}`, () => {
      const v = classifyFundBook(b);
      expect(v.rule).toBe(b.rule);
      expect(v.refuse).toBe(b.rule !== null);
    });
  }

  it("VMNFX ratios", () => {
    const v = classifyFundBook(REAL.VMNFX);
    expect(v.short_nav).toBeCloseTo(0.92403, 5);
    expect(v.net_nav).toBeCloseTo(0.04492, 5);
  });
});

describe("classifyFundBook rules", () => {
  const b = (L: number, S: number, nav: number | null): FundBookShape => ({
    teo: "2026-06-30", long_mv: L, short_mv: S, nav, n_long: 1, n_short: S ? 1 : 0,
  });
  it("R1 boundary at 5% of net assets", () => {
    expect(classifyFundBook(b(100, -5, 100)).rule).toBe("R1");
    expect(classifyFundBook(b(100, -4.99, 100)).refuse).toBe(false);
  });
  it("R2: small net book with a short leg >= 1%", () => {
    expect(classifyFundBook(b(30, -2, 100)).rule).toBe("R2");
  });
  it("small US sleeve without shorts is not refused", () => {
    expect(classifyFundBook(b(6.5, 0, 100)).refuse).toBe(false);
  });
  it("R3 when the filing has no NET_ASSETS header", () => {
    expect(classifyFundBook(b(100, -28, null)).rule).toBe("R3");
    expect(classifyFundBook(b(100, -1, null)).refuse).toBe(false);
  });
});

describe("column helpers", () => {
  it("latestFiledColumn skips forward-fill months and keeps a negative net", () => {
    expect(latestFiledColumn([7, null, -2, null])).toBe(2);
    expect(latestFiledColumn([null, 0, null])).toBe(-1);
  });
  it("totalBookColumn sums signed legs and uses NAV only for aum_source 1", () => {
    const s = totalBookColumn("2019-09-30", [60, -20, null, 0, 5], 100, 1);
    expect(s).toEqual({ teo: "2019-09-30", long_mv: 65, short_mv: -20, nav: 100, n_long: 2, n_short: 1 });
    expect(totalBookColumn("2018-12-31", [60, -20], 40, 0).nav).toBeNull();
  });
  it("aum_source 0: aum_reported (= net sum) is ignored and the short leg is tested against gross", () => {
    // 100 long / 90 short; aum_reported falls back to the net 10. As NAV, net/NAV
    // would read 100% and R2 would pass; the guard uses gross: 90 / 190 = 47% -> R3.
    const s = totalBookColumn("2018-12-31", [100, -90], 10, 0);
    expect(s.nav).toBeNull();
    const v = classifyFundBook(s);
    expect(v.rule).toBe("R3");
    // threshold on gross: 5.3 / 105.3 refuses, 5.2 / 105.2 does not
    expect(classifyFundBook(totalBookColumn("t", [100, -5.3], 94.7, 0)).rule).toBe("R3");
    expect(classifyFundBook(totalBookColumn("t", [100, -5.2], 94.8, 0)).refuse).toBe(false);
  });
});
