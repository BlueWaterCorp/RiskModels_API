import { afterEach, describe, expect, it } from "vitest";

import { isDeadSymbolRow, pickLiveRow } from "@/lib/dal/risk-engine-v3";
import { _reloadEtfCatalog, lookupEtfTicker } from "@/lib/dal/etf-catalog";
import { etfRegisterRole } from "@/lib/dal/etf-register";
import { etfRenamePartners, isSupersededByActiveRename } from "@/lib/dal/etf-renames";

/**
 * ERM3-68: SPLG was renamed SPYM on 2025-10-31 (same fund). ERM3 cuts over on a dated switch; the API follows
 * through RM_ETF_RENAME_SPLG_SPYM (default off). Ids are the production ones: the master's fund row
 * BW-BBG000KMT5K3 and the serial BW-SP7AMAMMMRW42 that ds_etf publishes for SPLG today.
 */
const superseded = {
  symbol: "BW-SP7AMAMMMRW42",
  ticker: "SPLG",
  metadata: {
    priced: false,
    last_return_teo: "2025-10-24",
    superseded_by: "BW-BBG000KMT5K3",
    renamed_to: "SPYM",
    renamed_on: "2025-10-31",
  },
};

afterEach(() => {
  delete process.env.RM_ETF_RENAME_SPLG_SPYM;
  _reloadEtfCatalog();
});

describe("ETF rename flag (default off)", () => {
  it("changes nothing while off", () => {
    expect(etfRenamePartners("SPYM")).toEqual([]);
    expect(isSupersededByActiveRename(superseded.metadata)).toBe(false);
    expect(isDeadSymbolRow(superseded)).toBe(false);
    expect(etfRegisterRole("SPLG")).toBe("broad_market");
    expect(etfRegisterRole("SPYM")).toBeNull();
    expect(lookupEtfTicker("SPLG")).toBe("BW-ETF-SPLG");
    expect(lookupEtfTicker("SPYM")).toBeNull();
  });

  it("retires the superseded row and links both tickers while on", () => {
    process.env.RM_ETF_RENAME_SPLG_SPYM = "1";
    expect(etfRenamePartners("splg")).toEqual(["SPYM"]);
    expect(isDeadSymbolRow(superseded)).toBe(true);
    // a superseded row never wins over a live one sharing the ticker
    const live = { symbol: "BW-BBG000KMT5K3", ticker: "SPLG", metadata: {} };
    expect(pickLiveRow([superseded, live])?.symbol).toBe("BW-BBG000KMT5K3");
    expect(etfRegisterRole("SPYM")).toBe("broad_market");
    expect(lookupEtfTicker("SPYM")).toBe("BW-ETF-SPLG");
    expect(lookupEtfTicker("SPLG")).toBe("BW-ETF-SPLG");
  });

  it("ignores a superseded stamp for a rename it does not know", () => {
    process.env.RM_ETF_RENAME_SPLG_SPYM = "1";
    expect(isDeadSymbolRow({ metadata: { superseded_by: "X", renamed_to: "QQQM" } })).toBe(false);
  });
});
