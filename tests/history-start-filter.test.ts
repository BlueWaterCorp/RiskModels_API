import { describe, expect, it } from "vitest";

import type { SecurityHistoryRow } from "@/lib/dal/risk-engine-v3";
import {
  filterRowsByHistoryStarts,
  firstValidIndex,
} from "@/lib/dal/zarr-reader";

const CRWV_SYMBOL = "CRWV";
const CRWV_HISTORY_START = "2025-03-28";

const crwvCalendarRows: SecurityHistoryRow[] = [
  {
    symbol: CRWV_SYMBOL,
    teo: "2025-03-26",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: null,
  },
  {
    symbol: CRWV_SYMBOL,
    teo: "2025-03-27",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: null,
  },
  {
    symbol: CRWV_SYMBOL,
    teo: "2025-03-28",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: 40,
  },
  {
    symbol: CRWV_SYMBOL,
    teo: "2025-03-31",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: 37.08000183105469,
  },
  {
    symbol: CRWV_SYMBOL,
    teo: "2025-04-01",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: 52.56999969482422,
  },
];

const aaplRows: SecurityHistoryRow[] = [
  {
    symbol: "AAPL",
    teo: "2025-10-27",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: 268.81,
  },
  {
    symbol: "AAPL",
    teo: "2025-10-28",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: 269,
  },
  {
    symbol: "AAPL",
    teo: "2025-10-29",
    periodicity: "daily",
    metric_key: "price_close",
    metric_value: 269.7,
  },
];

describe("security-specific history floor", () => {
  it("finds the first non-null core observation", () => {
    expect(firstValidIndex(crwvCalendarRows.map((row) => row.metric_value))).toBe(2);
  });

  it("starts a mid-window series at the first real observation", () => {
    const rows = filterRowsByHistoryStarts(crwvCalendarRows, {
      [CRWV_SYMBOL]: CRWV_HISTORY_START,
    });

    expect(rows.map((row) => row.teo)).toEqual([
      "2025-03-28",
      "2025-03-31",
      "2025-04-01",
    ]);
  });

  it("returns no rows when the whole window predates the security", () => {
    const rows = filterRowsByHistoryStarts(crwvCalendarRows.slice(0, 2), {
      [CRWV_SYMBOL]: CRWV_HISTORY_START,
    });

    expect(rows).toEqual([]);
  });

  it("leaves a full-history series unchanged", () => {
    expect(
      filterRowsByHistoryStarts(aaplRows, { AAPL: "1980-12-12" }),
    ).toEqual(aaplRows);
  });
});
