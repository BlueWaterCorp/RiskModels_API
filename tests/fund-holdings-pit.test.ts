import { describe, expect, it, vi } from "vitest";
import { BoolArray } from "zarrita";

import {
  decodeFundFilingDateSource,
  decodeNumericCells,
  resolveFundBookRowsAtTeo,
  selectFundHoldingsTeoIndex,
} from "@/lib/dal/funds-zarr-reader";

// Real Contrafund reporting facts around the June 2020 filing. The monthly
// axis carries March forward through April and May; only March and June are
// real filing columns.
const TEOS = ["2020-03-31", "2020-04-30", "2020-05-31", "2020-06-30"];
const FILING_DATES = ["2020-05-26", "", "", "2020-08-20"];
const AUM_REPORTED = [98_400_000_000, null, null, 121_367_000_000];
const AUM_ERM3 = [null, null, null, 114_036_000_000];
const BOOK_ROWS = [224, 0, 0, 278];
const REAL_FILING = [true, false, false, true];

function select(asOf: string | undefined, timeBasis: "report_date" | "available_date") {
  const hasNewDataAt = vi.fn(async (idx: number) => REAL_FILING[idx] ?? false);
  return {
    result: selectFundHoldingsTeoIndex({
      teos: TEOS,
      filingDates: FILING_DATES,
      aumReported: AUM_REPORTED,
      aumErm3: AUM_ERM3,
      asOf,
      timeBasis,
      hasNewDataAt,
    }),
    hasNewDataAt,
  };
}

describe("Contrafund point-in-time holdings selection", () => {
  it("selects the 2020-06-30 report in default report-date mode", async () => {
    const { result } = select("2020-06-30", "report_date");
    const idx = await result;
    expect(TEOS[idx]).toBe("2020-06-30");
    expect(FILING_DATES[idx]).toBe("2020-08-20");
  });

  it("selects the filing available on 2020-06-30", async () => {
    const { result, hasNewDataAt } = select("2020-06-30", "available_date");
    const idx = await result;
    expect(TEOS[idx]).toBe("2020-03-31");
    expect(FILING_DATES[idx]).toBe("2020-05-26");
    expect(AUM_REPORTED[idx]).toBe(98_400_000_000);
    expect(hasNewDataAt).not.toHaveBeenCalled();
  });

  it("returns no column before the first real report or filing", async () => {
    expect(await select("2020-03-01", "report_date").result).toBe(-1);
    expect(await select("2020-03-01", "available_date").result).toBe(-1);
  });

  it("does not label a forward-filled month as a report date", async () => {
    const { result } = select("2020-05-31", "report_date");
    expect(TEOS[await result]).toBe("2020-03-31");
  });

  it("keeps the undated latest-book selection rule unchanged", async () => {
    const { result, hasNewDataAt } = select(undefined, "report_date");
    expect(TEOS[await result]).toBe("2020-06-30");
    expect(hasNewDataAt).not.toHaveBeenCalled();
  });

  it("decodes the bool-typed new-data column for the real filing months", () => {
    const column = decodeNumericCells(new BoolArray(REAL_FILING));
    expect(column).toEqual([1, 0, 0, 1]);
    expect(column?.some((cell) => cell != null && cell !== 0)).toBe(true);
  });

  it("reads the 2020-06-30 book row count from the teo variable", () => {
    const idx = TEOS.indexOf("2020-06-30");
    expect(resolveFundBookRowsAtTeo(BOOK_ROWS[idx], 999, idx, TEOS[idx]!)).toBe(278);
    expect(resolveFundBookRowsAtTeo(undefined, 278, idx, TEOS[idx]!)).toBe(278);
    expect(resolveFundBookRowsAtTeo(null, 999, idx, TEOS[idx]!)).toBeNull();
  });

  it("maps numeric filing-date provenance codes", () => {
    expect(decodeFundFilingDateSource(1)).toBe("exact");
    expect(decodeFundFilingDateSource(2)).toBe("approx");
    expect(decodeFundFilingDateSource(0)).toBeNull();
    expect(decodeFundFilingDateSource(null)).toBeNull();
  });
});
