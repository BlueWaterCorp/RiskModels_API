/**
 * RMAPI-14 routes: /api/data/etf/{ticker} capabilities + identifiers,
 * /api/data/etf/universe, and capability flags on /api/data/etf/search.
 * Zarr inputs and the holdings reader are mocked; the catalog is the
 * committed mcp/data/etf_master.json.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dal/zarr-reader", () => ({
  readEtfStoreIndex: async () => [
    { ticker: "SPY", bw_sym_id: "BW-BBG000BDTBL9", priced_from: "2000-01-03", priced_through: "2026-10-13" },
    { ticker: "LQD", bw_sym_id: "BW-BBG000BBV9N3", priced_from: "2002-07-26", priced_through: "2026-10-13" },
    { ticker: "IVV", bw_sym_id: "BW-BBG000BVZ4F5", priced_from: "2000-05-19", priced_through: "2026-10-13" },
  ],
  readCascadeEtfSets: async () => ({ market: "SPY", sectors: ["XLK"], subsectors: ["SMH"] }),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readEtfHoldingsTopN: vi.fn(),
}));

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET as getEtf } from "@/app/api/data/etf/[ticker]/route";
import { GET as getUniverse } from "@/app/api/data/etf/universe/route";
import { GET as getSearch } from "@/app/api/data/etf/search/route";
import { readEtfHoldingsTopN } from "@/lib/dal/funds-zarr-reader";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";
import { _resetEtfUniverseCache } from "@/lib/dal/etf-universe";

const mockHoldings = readEtfHoldingsTopN as unknown as ReturnType<typeof vi.fn>;
const mockResolve = resolveSymbolByTicker as unknown as ReturnType<typeof vi.fn>;

const IVV_SNAPSHOT = {
  portfolio_id: "BW-ETF-IVV",
  ticker: "IVV",
  source_kind: "etf" as const,
  teo_frequency: "daily" as const,
  sponsor: "ishares",
  report_date: "2026-10-13",
  availability_date: "2026-10-14",
  aum_reported: 998_000_000,
  aum_erm3: 990_000_000,
  coverage_pct: 0.992,
  n_holdings_returned: 1,
  n_total_holdings: 503,
  holdings: [],
};

const etf = (t: string) =>
  getEtf(new NextRequest(`http://x/api/data/etf/${t}`), { params: Promise.resolve({ ticker: t }) });

beforeEach(() => {
  _resetEtfUniverseCache();
  mockHoldings.mockReset();
  mockResolve.mockReset();
  mockHoldings.mockResolvedValue(null);
  mockResolve.mockResolvedValue(null);
});

describe("GET /api/data/etf/{ticker}", () => {
  it("keeps the surface fields for a holdings fund and adds capabilities + identifiers", async () => {
    mockHoldings.mockResolvedValue(IVV_SNAPSHOT);
    const res = await etf("IVV");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-10-13");
    const body = await res.json();
    expect(body).toMatchObject({
      portfolio_id: "BW-ETF-IVV",
      ticker: "IVV",
      aum_reported: 998_000_000,
      n_total_holdings: 503,
    });
    expect(body.holdings).toBeUndefined();
    expect(body.capabilities).toEqual({
      cascade: false,
      priced: true,
      priced_from: "2000-05-19",
      holdings: true,
      holdings_as_of: "2026-10-13",
      factor_role: "none",
    });
    expect(body.identifiers).toEqual({
      bw_sym_id: "BW-BBG000BVZ4F5",
      bw_etf_id: "BW-ETF-IVV",
      figi: "BBG000BVZ4F5",
      cik: null,
      ticker: "IVV",
    });
  });

  it("returns 200 for a priced fund without holdings (was 404)", async () => {
    const res = await etf("lqd");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticker).toBe("LQD");
    expect(body.capabilities).toMatchObject({ priced: true, holdings: false, holdings_as_of: null, cascade: false });
    expect(mockHoldings).not.toHaveBeenCalled();
  });

  it("returns 200 for a cascade fund off the other lists", async () => {
    const body = await (await etf("SMH")).json();
    expect(body.capabilities).toMatchObject({ cascade: true, factor_role: "subsector" });
  });

  it("returns 200 with no capabilities for an ETF known only to the symbol registry (HYG)", async () => {
    // Registry ids keyed on a licensed identifier (legacy shape; placeholder
    // digits) are withheld, so HYG carries no served ids beyond its ticker.
    mockResolve.mockResolvedValue({ symbol: "BW-US0000000001", ticker: "HYG", name: null, asset_type: "etf" });
    const res = await etf("HYG");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ticker: "HYG",
      name: null,
      capabilities: {
        cascade: false,
        priced: false,
        priced_from: null,
        holdings: false,
        holdings_as_of: null,
        factor_role: "none",
      },
      identifiers: { bw_sym_id: null, bw_etf_id: null, figi: null, cik: null, ticker: "HYG" },
    });
  });

  it("404s with symbol_not_found only when unknown everywhere (stocks are not ETFs)", async () => {
    mockResolve.mockResolvedValue({ symbol: "BW-AAPL", ticker: "AAPL", name: null, asset_type: "stock" });
    const res = await etf("AAPL");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("symbol_not_found");
    mockResolve.mockResolvedValue(null);
    expect((await etf("NOPEX")).status).toBe(404);
  });
});

describe("GET /api/data/etf/universe", () => {
  it("returns the union with counts and capability flags", async () => {
    const res = await getUniverse(new NextRequest("http://x/api/data/etf/universe"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.n_results).toBe(body.counts.total);
    expect(body.counts.priced).toBe(3);
    expect(body.reason_codes).toEqual([
      "etf_outside_priced_universe",
      "etf_no_return_history_in_window",
      "symbol_not_found",
    ]);
    const spy = body.results.find((r: { ticker: string }) => r.ticker === "SPY");
    expect(spy.capabilities).toMatchObject({ cascade: true, priced: true, holdings: true, factor_role: "market" });
  });

  it("filters by capability query params", async () => {
    const res = await getUniverse(new NextRequest("http://x/api/data/etf/universe?priced=true&holdings=false"));
    const body = await res.json();
    expect(body.results.map((r: { ticker: string }) => r.ticker)).toEqual(["LQD"]);
    const cascade = await (await getUniverse(new NextRequest("http://x/api/data/etf/universe?cascade=true"))).json();
    expect(cascade.results.map((r: { ticker: string }) => r.ticker).sort()).toEqual(["SMH", "SPY", "XLK"]);
  });
});

describe("GET /api/data/etf/search", () => {
  it("returns capability flags on each hit and finds priced-only funds", async () => {
    const body = await (await getSearch(new NextRequest("http://x/api/data/etf/search?q=EFA"))).json();
    expect(body.results[0]).toMatchObject({
      ticker: "EFA",
      bw_etf_id: "BW-ETF-EFA",
      score: 100,
      capabilities: { cascade: false, priced: false, holdings: true },
    });
    const lqd = await (await getSearch(new NextRequest("http://x/api/data/etf/search?q=LQD"))).json();
    expect(lqd.results[0]).toMatchObject({ ticker: "LQD", bw_etf_id: null, capabilities: { priced: true, holdings: false } });
  });
});
