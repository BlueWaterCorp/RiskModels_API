/**
 * lib/dal/etf-universe — RMAPI-14 ETF universe with three capabilities.
 *
 * The holdings catalog is the committed mcp/data/etf_master.json. The two
 * zarr inputs (ETF return store symbol list, weekly hedge snapshot cascade
 * coords) are mocked with rows copied from the 2026-10-14 ds_etf build.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeRows = [
  { ticker: "SPY", bw_sym_id: "BW-BBG000BDTBL9", priced_from: "2000-01-03", priced_through: "2026-10-13" },
  { ticker: "XLK", bw_sym_id: "BW-BBG000BJ7007", priced_from: "2000-01-03", priced_through: "2026-10-13" },
  { ticker: "SMH", bw_sym_id: "BW-BBG000BV7ZQ5", priced_from: "2000-05-05", priced_through: "2026-10-13" },
  { ticker: "LQD", bw_sym_id: "BW-BBG000BBV9N3", priced_from: "2002-07-26", priced_through: "2026-10-13" },
  { ticker: "CYB", bw_sym_id: "BW-SQHR1KFHT4MQ9", priced_from: "2008-05-14", priced_through: "2026-10-13" },
  // A legacy id shape that embeds a licensed identifier must never be served.
  { ticker: "ZZZ", bw_sym_id: "BW-US0000000001", priced_from: "2010-01-04", priced_through: "2026-10-13" },
];
const cascadeSets = { market: "SPY", sectors: ["XLK", "XLF"], subsectors: ["SMH"] };

const readEtfStoreIndex = vi.fn(async () => storeRows);
const readCascadeEtfSets = vi.fn(async () => cascadeSets as typeof cascadeSets | null);

vi.mock("@/lib/dal/zarr-reader", () => ({
  readEtfStoreIndex: () => readEtfStoreIndex(),
  readCascadeEtfSets: () => readCascadeEtfSets(),
}));

import {
  _resetEtfUniverseCache,
  buildEtfUniverse,
  classifyEmptyEtfReturns,
  figiFrom,
  getEtfUniverseRow,
  matchesCapabilityFilter,
  parseCapabilityFilter,
  safeBwSymId,
} from "@/lib/dal/etf-universe";

beforeEach(() => {
  _resetEtfUniverseCache();
  readEtfStoreIndex.mockClear();
  readCascadeEtfSets.mockReset();
  readCascadeEtfSets.mockImplementation(async () => cascadeSets);
});

describe("buildEtfUniverse", () => {
  it("unions catalog, priced store and cascade lists with independent flags", async () => {
    const u = await buildEtfUniverse();
    const by = new Map(u.rows.map((r) => [r.ticker, r]));

    // SPY: on all three lists.
    expect(by.get("SPY")!.capabilities).toMatchObject({
      cascade: true,
      priced: true,
      priced_from: "2000-01-03",
      holdings: true,
      factor_role: "market",
    });
    expect(by.get("SPY")!.identifiers).toEqual({
      bw_sym_id: "BW-BBG000BDTBL9",
      bw_etf_id: "BW-ETF-SPY",
      figi: "BBG000BDTBL9",
      cik: null,
      ticker: "SPY",
    });

    // LQD: priced only; macro role from the committed register mirror.
    expect(by.get("LQD")!.capabilities).toMatchObject({ cascade: false, priced: true, holdings: false, factor_role: "macro:fixed_income" });
    // EFA: holdings only (the review's symbol_not_found case).
    expect(by.get("EFA")!.capabilities).toMatchObject({ cascade: false, priced: false, priced_from: null, holdings: true });
    // XLF: cascade + holdings, not in the mocked store.
    expect(by.get("XLF")!.capabilities).toMatchObject({ cascade: true, priced: false, factor_role: "sector" });
    // SMH: subsector role from the cascade store.
    expect(by.get("SMH")!.capabilities.factor_role).toBe("subsector");
    // Register adds style roles; its cascade roles yield to the live store, so a
    // register subsector fund the store does not hedge with stays "none".
    expect(by.get("MTUM")!.capabilities.factor_role).toBe("style");
    expect(by.get("AIRR")!.capabilities).toMatchObject({ cascade: false, factor_role: "none" });
    // Opaque BW id: served, no FIGI.
    expect(by.get("CYB")!.identifiers).toMatchObject({ bw_sym_id: "BW-SQHR1KFHT4MQ9", figi: null });
    // Licensed-shape id withheld.
    expect(by.get("ZZZ")!.identifiers.bw_sym_id).toBeNull();

    expect(u.counts.priced).toBe(storeRows.length);
    expect(u.counts.total).toBe(u.rows.length);
    expect(u.sources).toMatchObject({ catalog: true, priced_store: true, cascade_store: true });
    // Sorted by ticker.
    expect(u.rows.map((r) => r.ticker)).toEqual([...u.rows.map((r) => r.ticker)].sort((a, b) => a.localeCompare(b)));
  });

  it("falls back to the public market + sector list when the cascade store is unreachable", async () => {
    readCascadeEtfSets.mockImplementation(async () => null);
    const u = await buildEtfUniverse();
    const by = new Map(u.rows.map((r) => [r.ticker, r]));
    expect(by.get("SPY")!.capabilities.factor_role).toBe("market");
    expect(by.get("XLRE")!.capabilities).toMatchObject({ cascade: true, factor_role: "sector" });
    expect(by.get("SMH")!.capabilities.cascade).toBe(false);
    expect(u.sources.cascade_store).toBe(false);
  });
});

describe("identifier hygiene", () => {
  it("withholds licensed-shape ids and derives FIGI only from FIGI-based ids", () => {
    expect(safeBwSymId("BW-US78462F1030")).toBeNull();
    expect(safeBwSymId("BW-BBG000BDTBL9")).toBe("BW-BBG000BDTBL9");
    expect(safeBwSymId("SPY")).toBeNull();
    expect(figiFrom(null, "BW-BBG000BDTBL9")).toBe("BBG000BDTBL9");
    expect(figiFrom(null, "BW-SQHR1KFHT4MQ9")).toBeNull();
    expect(figiFrom("not-a-figi", null)).toBeNull();
  });
});

describe("capability filters", () => {
  it("parses booleans and factor_role and filters rows", async () => {
    const f = parseCapabilityFilter(new URLSearchParams("priced=true&holdings=false"));
    expect(f).toEqual({ cascade: undefined, priced: true, holdings: false });
    const u = await buildEtfUniverse();
    const hit = u.rows.filter((r) => matchesCapabilityFilter(r, f)).map((r) => r.ticker);
    expect(hit).toContain("LQD");
    expect(hit).not.toContain("SPY");
    const sectors = u.rows.filter((r) => matchesCapabilityFilter(r, parseCapabilityFilter(new URLSearchParams("factor_role=sector"))));
    expect(sectors.map((r) => r.ticker).sort()).toEqual(["XLF", "XLK"]);
  });
});

describe("classifyEmptyEtfReturns", () => {
  it("names the reason for an empty ETF return series", async () => {
    expect(await classifyEmptyEtfReturns("EFA")).toBe("etf_outside_priced_universe");
    expect(await classifyEmptyEtfReturns("HYG")).toBe("etf_outside_priced_universe");
    expect(await classifyEmptyEtfReturns("SPY")).toBe("etf_no_return_history_in_window");
    expect((await getEtfUniverseRow("spy"))!.ticker).toBe("SPY");
  });
});
