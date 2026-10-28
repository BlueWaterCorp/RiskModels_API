/**
 * ERM3-88: /ticker-returns for GOOGL serves GOOG's returns and hedges but not
 * GOOG's close as GOOGL's price. Rows are GOOG's published 2025-10-28 values.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: (handler: (req: unknown, ctx: unknown) => Promise<Response>) => async (req: Request) =>
    handler(req, {
      requestId: "test-req",
      userId: "u1",
      costUsd: 0.02,
      rawFieldsPermitted: true,
      setBillableItemCount: () => {},
    }),
}));

const { symbolRows } = vi.hoisted(() => {
  const goog = {
    symbol: "BW-BBG009S3NB30",
    ticker: "GOOG",
    name: null,
    asset_type: "stock",
    sector_etf: "XLC",
    subsector_etf: "FDN",
    is_adr: null,
    is_modelled_class: true,
    modelled_ticker: null,
    share_class: null,
    modelled_share_class: null,
  };
  return {
    symbolRows: {
      GOOG: goog,
      GOOGL: {
        ...goog,
        ticker: "GOOGL",
        is_modelled_class: false,
        modelled_ticker: "GOOG",
        share_class: "A",
        modelled_share_class: "C",
        resolved_via: "share_class_sibling",
      },
    } as Record<string, Record<string, unknown>>,
  };
});

const fetchHistory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(async (t: string) => symbolRows[t.toUpperCase()] ?? null),
  fetchHistoryWithSource: fetchHistory,
  pivotHistory: vi.fn((rows: Array<Record<string, unknown>>) => rows),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: async () => ({
    model_version: "3.0",
    data_as_of: "2026-10-26",
    factor_set_id: "SPY_uni_mc_3000",
    universe_size: 3278,
    wiki_uri: "",
    factors: ["SPY"],
  }),
}));

vi.mock("@/lib/data-license", () => ({
  getDataLicenseMode: () => "licensed",
  isRestrictedSourceSymbol: () => false,
  RESTRICTED_SOURCE_NOTE: {},
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/ticker-returns/route";

const GOOG_ROW = {
  teo: "2025-10-28",
  returns_gross: -0.005557122640311718,
  price_close: 268.42999267578125,
  l3_mkt_hr: -0.36282050609588623,
  l3_sec_hr: -0.4794802963733673,
  l3_sub_hr: -0.19794578850269318,
};

async function call(ticker: string) {
  fetchHistory.mockImplementation(async (_symbol: string, keys: string[]) => ({
    rows: [Object.fromEntries(Object.entries(GOOG_ROW).filter(([k]) => k === "teo" || keys.includes(k)))],
    dataSource: "zarr",
  }));
  return GET(new NextRequest(`http://x/api/ticker-returns?ticker=${ticker}&years=1`));
}

describe("GET /api/ticker-returns — share-class sibling (ERM3-88)", () => {
  it("GOOGL: GOOG's returns and hedges, no price_close, flagged", async () => {
    const res = await call("GOOGL");
    const body = await res.json();
    expect(body.symbol).toBe("BW-BBG009S3NB30");
    expect(body.ticker).toBe("GOOGL");
    expect(body).toMatchObject({
      resolved_via: "share_class_sibling",
      requested_ticker: "GOOGL",
      modelled_ticker: "GOOG",
      price_withheld: true,
    });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].returns_gross).toBeCloseTo(-0.005557122640311718, 12);
    expect(body.data[0].l3_mkt_hr).toBeCloseTo(-0.36282050609588623, 12);
    expect(body.data[0]).not.toHaveProperty("price_close");
    expect(fetchHistory.mock.calls.at(-1)?.[1]).not.toContain("price_close");
    expect(res.headers.get("X-Ticker-Resolved-Via")).toBe("share_class_sibling");
    expect(res.headers.get("X-Ticker-Price-Withheld")).toBe("true");
  });

  it("GOOG keeps its own price_close and carries no flag", async () => {
    const body = await (await call("GOOG")).json();
    expect(body.data[0].price_close).toBeCloseTo(268.42999267578125, 8);
    expect(body.resolved_via).toBeUndefined();
    expect(body.price_withheld).toBeUndefined();
  });
});
