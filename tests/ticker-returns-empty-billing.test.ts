/**
 * RMAPI-14: /api/ticker-returns does not bill an empty response, and the
 * warning names the reason instead of "retry / contact support".
 * (Review case: HYG returned 0 rows and billed, request req_mv8frd0k_vut3r8.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  count: null as number | null,
  options: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: (
    handler: (req: unknown, ctx: unknown) => Promise<Response>,
    options: Record<string, unknown>,
  ) => {
    billing.options = options;
    return async (req: Request) => {
      const ctx: Record<string, unknown> = {
        requestId: "test-req",
        userId: "u1",
        costUsd: 0.02,
        rawFieldsPermitted: true,
      };
      ctx.setBillableItemCount = (n: number) => {
        billing.count = n;
        ctx.costUsd = n === 0 ? 0 : 0.02;
      };
      return handler(req, ctx);
    };
  },
}));

const { symbolRows, history } = vi.hoisted(() => ({
  history: {
    rows: [] as Array<Record<string, unknown>>,
    historyStarts: {} as Record<string, string>,
  },
  symbolRows: {
  HYG: { symbol: "BW-HYG", ticker: "HYG", name: null, asset_type: "etf", sector_etf: null, subsector_etf: null, is_modelled_class: true },
  SPY: { symbol: "BW-BBG000BDTBL9", ticker: "SPY", name: null, asset_type: "etf", sector_etf: null, subsector_etf: null, is_modelled_class: true },
  AAPL: { symbol: "BW-AAPL", ticker: "AAPL", name: null, asset_type: "stock", sector_etf: "XLK", subsector_etf: null, is_modelled_class: true },
  } as Record<string, Record<string, unknown>>,
}));

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(async (t: string) => symbolRows[t.toUpperCase()] ?? null),
  fetchHistoryWithSource: vi.fn(async () => ({
    rows: history.rows,
    dataSource: "zarr",
    historyStarts: history.historyStarts,
  })),
  pivotHistory: vi.fn((rows: Array<Record<string, unknown>>) => rows),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: async () => ({
    model_version: "ERM3",
    data_as_of: "2026-10-13",
    factor_set_id: "SPY_uni_mc_3000",
    universe_size: 3000,
    wiki_uri: "",
    factors: ["SPY"],
  }),
}));

vi.mock("@/lib/data-license", () => ({
  getDataLicenseMode: () => "licensed",
  isRestrictedSourceSymbol: () => false,
  RESTRICTED_SOURCE_NOTE: {},
}));

vi.mock("@/lib/dal/etf-universe", () => ({
  ETF_REASON_CODES: {
    outside_priced: "etf_outside_priced_universe",
    no_history_in_window: "etf_no_return_history_in_window",
    not_found: "symbol_not_found",
  },
  classifyEmptyEtfReturns: vi.fn(async (t: string) =>
    t === "SPY" ? "etf_no_return_history_in_window" : "etf_outside_priced_universe",
  ),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/ticker-returns/route";

const call = (ticker: string) => GET(new NextRequest(`http://x/api/ticker-returns?ticker=${ticker}&years=1`));

beforeEach(() => {
  billing.count = null;
  history.rows = [];
  history.historyStarts = {};
});

describe("GET /api/ticker-returns — empty responses", () => {
  it("registers itemCount so the handler can lower the charge", () => {
    expect(billing.options).toMatchObject({ capabilityId: "ticker-returns", itemCount: 1 });
  });

  it("does not bill an ETF outside the priced universe and names the reason", async () => {
    const res = await call("HYG");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(billing.count).toBe(0);
    expect(body.data).toEqual([]);
    expect(body._agent.cost_usd).toBe(0);
    expect(body._metadata.data_warning_code).toBe("etf_outside_priced_universe");
    expect(body._metadata.see).toBe("/api/data/etf/HYG");
    expect(body._metadata.data_warning).toMatch(/outside the priced ETF universe/);
    expect(body._metadata.data_warning).not.toMatch(/retry|contact support/i);
  });

  it("names etf_no_return_history_in_window for a priced ETF with no rows in the window", async () => {
    const body = await (await call("SPY")).json();
    expect(billing.count).toBe(0);
    expect(body._metadata.data_warning_code).toBe("etf_no_return_history_in_window");
  });

  it("does not bill an empty stock series either", async () => {
    history.historyStarts = { "BW-AAPL": "1980-12-12" };
    const body = await (await call("AAPL")).json();
    expect(billing.count).toBe(0);
    expect(body._metadata.data_warning_code).toBe("no_return_history_in_window");
    expect(body.history_starts).toBe("1980-12-12");
    expect(body._metadata.data_warning).not.toMatch(/retry|contact support/i);
  });

  it("bills normally when rows return", async () => {
    history.rows = [{ teo: "2026-10-13", returns_gross: 0.001, price_close: 600 }];
    const body = await (await call("SPY")).json();
    expect(billing.count).toBeNull();
    expect(body._agent.cost_usd).toBe(0.02);
    expect(body._metadata.data_warning).toBeUndefined();
  });
});
