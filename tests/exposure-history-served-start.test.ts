import { describe, expect, it } from "vitest";
import { EXPOSURE_PANEL_VARS, type DailyExposureHistory, type ExposurePanelSlice } from "@/lib/dal/zarr-reader";
import { SERVED_HISTORY_START } from "@/lib/dal/served-history";
import {
  EXPOSURE_FIELD_START,
  EXPOSURE_HISTORY_START,
  buildDailyNameRows,
  buildHistoryTables,
  maskBeforeServedStart,
  servedStartWarnings,
} from "@/lib/portfolio/exposure-history";

describe("served-history floors for the exposure history feeds", () => {
  it("maps every delivered column to its product's served start", () => {
    expect(EXPOSURE_HISTORY_START).toBe(SERVED_HISTORY_START.hedge_ratio);
    expect(EXPOSURE_FIELD_START).toMatchObject({
      l1_mkt_hr: "2010-12-08",
      l3_sub_hr: "2010-12-08",
      l1_mkt_beta: "2010-12-08",
      l3_res_er: "2011-12-07",
      l3_mkt_er: "2011-12-07",
      stock_var: "2011-12-07",
      lstar_level: "2013-01-01",
    });
    for (const v of EXPOSURE_PANEL_VARS) expect(EXPOSURE_FIELD_START[v]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("withholds month-end values dated before each column's floor", () => {
    const teos = ["2010-11-30", "2010-12-31", "2011-12-30", "2012-12-31", "2013-01-31"];
    const filled = (x: number) => teos.map(() => x);
    const cols = Object.fromEntries(EXPOSURE_PANEL_VARS.map((v) => [v, filled(0.5)])) as Record<
      (typeof EXPOSURE_PANEL_VARS)[number],
      Array<number | null>
    >;
    cols.l1_mkt_hr = filled(-1.2);
    cols.lstar_level = filled(2);
    const slice: ExposurePanelSlice = { teos, bySymbol: new Map([["S-A", cols]]), etfs: [], cov: [], attrs: {} };
    maskBeforeServedStart(slice.teos, slice.bySymbol);
    const c = slice.bySymbol.get("S-A")!;
    expect(c.l1_mkt_hr).toEqual([null, -1.2, -1.2, -1.2, -1.2]);
    expect(c.l3_res_er).toEqual([null, null, 0.5, 0.5, 0.5]);
    expect(c.stock_var).toEqual([null, null, 0.5, 0.5, 0.5]);
    expect(c.lstar_level).toEqual([null, null, null, null, 2]);

    // The fully withheld month drops out; l1_mkt_beta follows l1_mkt_hr.
    const t = buildHistoryTables(slice, [{ symbol: "S-A", tickers: ["A"], sector_etf: null, subsector_etf: null }], []);
    expect(t.names.map((r) => r.teo)).toEqual(teos.slice(1));
    expect(t.names[0]).toMatchObject({ l1_mkt_beta: expect.closeTo(1.2, 5), l3_res_er: null, lstar_level: null });
  });

  it("withholds daily values (NaN) dated before each column's floor", () => {
    const teos = ["2010-12-07", "2010-12-08", "2011-12-06", "2011-12-07", "2012-12-31", "2013-01-02"];
    const col = (x: number) => Float32Array.from(teos.map(() => x));
    const cols = Object.fromEntries(EXPOSURE_PANEL_VARS.map((v) => [v, col(0.25)])) as Record<
      (typeof EXPOSURE_PANEL_VARS)[number],
      Float32Array
    >;
    const daily: DailyExposureHistory = { teos, bySymbol: new Map([["S-A", cols]]) };
    maskBeforeServedStart(daily.teos, daily.bySymbol);
    const finiteFrom = (a: Float32Array) => Array.from(a).findIndex((x) => Number.isFinite(x));
    expect(teos[finiteFrom(cols.l2_sec_hr)]).toBe("2010-12-08");
    expect(teos[finiteFrom(cols.l1_res_er)]).toBe("2011-12-07");
    expect(teos[finiteFrom(cols.lstar_level)]).toBe("2013-01-02");
    const names = [{ symbol: "S-A", tickers: ["A"], sector_etf: null, subsector_etf: null }];
    expect(buildDailyNameRows(daily, names, "2010").map((r) => r.teo)).toEqual(["2010-12-08"]);
  });

  it("warns once per later floor when the requested start precedes it", () => {
    expect(servedStartWarnings(undefined)).toEqual([]);
    expect(servedStartWarnings("2013-01-01")).toEqual([]);

    const early = servedStartWarnings("2006-01-01");
    expect(early.map((w) => w.available_from)).toEqual(["2010-12-08", "2011-12-07", "2013-01-01"]);
    expect(early.every((w) => w.code === "before_served_history")).toBe(true);
    expect(early[0]!.message).toMatch(/no rows before 2010-12-08/);
    expect(early[0]!.columns).toEqual(expect.arrayContaining(["l1_mkt_hr", "l1_mkt_beta"]));
    expect(early[1]!.columns).toEqual(expect.arrayContaining(["l3_res_er", "stock_var"]));
    expect(early[2]!.columns).toEqual(["lstar_level"]);

    // Between floors: only the later ones are named, and no "no rows" message.
    const mid = servedStartWarnings("2012-06-29");
    expect(mid.map((w) => w.available_from)).toEqual(["2013-01-01"]);
    expect(mid[0]!.message).toBe("lstar_level served from 2013-01-01; null before.");
  });
});
