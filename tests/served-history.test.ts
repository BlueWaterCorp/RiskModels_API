import { describe, expect, it } from "vitest";

import {
  SERVED_HISTORY_START,
  clampStart,
  servedHistoryStartForKeys,
  servedProductForKey,
} from "@/lib/dal/served-history";

describe("served-history", () => {
  it("maps keys to products", () => {
    expect(servedProductForKey("price_close")).toBeNull();
    expect(servedProductForKey("returns_gross")).toBeNull();
    expect(servedProductForKey("market_cap")).toBe("market_cap");
    expect(servedProductForKey("l1_mkt_hr")).toBe("hedge_ratio");
    expect(servedProductForKey("l1_mkt_er")).toBe("explained_risk");
    expect(servedProductForKey("l1_rr")).toBe("returns_decomposition");
  });

  it("uses the latest floor across requested keys", () => {
    expect(servedHistoryStartForKeys(["price_close"])).toBe("");
    expect(servedHistoryStartForKeys(["l1_mkt_hr"])).toBe(SERVED_HISTORY_START.hedge_ratio);
    expect(servedHistoryStartForKeys(["l1_mkt_hr", "l1_rr"])).toBe(
      SERVED_HISTORY_START.returns_decomposition,
    );
  });

  it("clamps early or missing starts and keeps later ones", () => {
    const f = SERVED_HISTORY_START.hedge_ratio;
    expect(clampStart(undefined, f)).toBe(f);
    expect(clampStart("2000-01-03", f)).toBe(f);
    expect(clampStart("2020-01-02", f)).toBe("2020-01-02");
    expect(clampStart("2000-01-03", "")).toBe("2000-01-03");
  });
});

describe("historyAvailableFromError", () => {
  it("names the first available date for an as_of before the floor", async () => {
    const { historyAvailableFromError } = await import("@/lib/dal/served-history");
    const f = SERVED_HISTORY_START.explained_risk;
    expect(historyAvailableFromError("2005-06-30", f)).toEqual({
      error: `No data served for as_of=2005-06-30: history available from ${f}`,
      as_of: "2005-06-30",
      as_of_basis: "report_date",
      history_available_from: f,
    });
    expect(historyAvailableFromError(f, f)).toBeNull();
    expect(historyAvailableFromError(undefined, f)).toBeNull();
  });
});
