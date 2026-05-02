import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchFund,
  fetchFundLatest,
  getStyleCellMembers,
  resolveFundById,
  resolveFundsByIds,
  searchFunds,
} from "@/lib/dal/funds-engine";

type Result<T> = { data: T; error: unknown };

interface QueryStub {
  select: () => QueryStub;
  eq: () => QueryStub;
  in: () => QueryStub;
  is: () => QueryStub;
  or: () => QueryStub;
  ilike: () => QueryStub;
  order: () => QueryStub;
  limit: () => QueryStub;
  maybeSingle: () => Promise<Result<unknown>>;
  then: <R>(
    resolve: (value: Result<unknown>) => R,
    reject?: (error: unknown) => R,
  ) => Promise<R>;
}

function makeQuery(result: Result<unknown>): QueryStub {
  const stub = {} as QueryStub;
  stub.select = () => stub;
  stub.eq = () => stub;
  stub.in = () => stub;
  stub.is = () => stub;
  stub.or = () => stub;
  stub.ilike = () => stub;
  stub.order = () => stub;
  stub.limit = () => stub;
  stub.maybeSingle = () => Promise.resolve(result);
  stub.then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return stub;
}

function setMockClient(byTable: Record<string, Result<unknown>>) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: (table: string) => {
      const result = byTable[table];
      if (!result) throw new Error(`unmocked table: ${table}`);
      return makeQuery(result);
    },
  } as never);
}

const FUND_VFINX = {
  bw_fund_id: "BW-FUND-S000004310",
  series_id: "S000004310",
  ticker: "VFINX",
  cik: "0000036405",
  fund_name: "Vanguard 500 Index Fund Investor Shares",
  morningstar_category: "Large Blend",
  equity_style_9box: "Large Blend",
  style_link_method: "ticker_match",
  primary_bw_fund_id: null,
  latest_report_date: "2026-04-30",
  latest_filing_date: "2026-07-14",
  latest_extracted_at: "2026-05-02T16:38:21.330085+00:00",
  latest_total_adj_mv: 25_000_000_000,
  latest_n_holdings: 503,
  latest_effective_n: 102.4,
  last_in_eligible_universe_at: null,
  metadata: {},
};

const FUND_LATEST_VFINX = {
  bw_fund_id: "BW-FUND-S000004310",
  report_date: "2026-04-30",
  filing_date: "2026-07-14",
  extracted_at: "2026-05-02T16:38:21.330085+00:00",
  portfolio_gross_return: 0.071,
  portfolio_market_return: 0.099,
  portfolio_sector_return: -0.01,
  portfolio_subsector_return: -0.01,
  portfolio_idiosyncratic_return: -0.005,
  identity_residual: -0.003,
  weight_sum: 0.99,
  n_holdings_active: 503,
  effective_n: 102.4,
  top10_weight_sum: 0.34,
  total_adj_mv: 25_000_000_000,
  equity_style_9box: "Large Blend",
  n_funds_in_cell_at_report_date: 1234,
  model_version: "funds_dag.v20260502",
  factor_set_id: "uni_mc_3000_SPY",
  last_synced_at: "2026-05-02T16:41:31.441605+00:00",
  metadata: {},
};

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
});

describe("fetchFund", () => {
  it("returns the row when found", async () => {
    setMockClient({ funds: { data: FUND_VFINX, error: null } });
    const r = await fetchFund("BW-FUND-S000004310");
    expect(r?.bw_fund_id).toBe("BW-FUND-S000004310");
    expect(r?.ticker).toBe("VFINX");
  });

  it("returns null on error", async () => {
    setMockClient({
      funds: { data: null, error: { message: "boom" } },
    });
    const r = await fetchFund("BW-FUND-MISSING");
    expect(r).toBeNull();
  });

  it("returns null when no row", async () => {
    setMockClient({ funds: { data: null, error: null } });
    const r = await fetchFund("BW-FUND-MISSING");
    expect(r).toBeNull();
  });
});

describe("fetchFundLatest", () => {
  it("returns the latest row when found", async () => {
    setMockClient({
      funds_latest: { data: FUND_LATEST_VFINX, error: null },
    });
    const r = await fetchFundLatest("BW-FUND-S000004310");
    expect(r?.report_date).toBe("2026-04-30");
    expect(r?.filing_date).toBe("2026-07-14");
  });
});

describe("resolveFundById", () => {
  it("joins fund + latest", async () => {
    setMockClient({
      funds: { data: FUND_VFINX, error: null },
      funds_latest: { data: FUND_LATEST_VFINX, error: null },
    });
    const r = await resolveFundById("BW-FUND-S000004310");
    expect(r?.fund.ticker).toBe("VFINX");
    expect(r?.latest?.portfolio_gross_return).toBeCloseTo(0.071);
  });

  it("returns null when fund not found, even if latest exists", async () => {
    setMockClient({
      funds: { data: null, error: null },
      funds_latest: { data: FUND_LATEST_VFINX, error: null },
    });
    const r = await resolveFundById("BW-FUND-MISSING");
    expect(r).toBeNull();
  });

  it("returns fund with null latest when only registry row exists", async () => {
    setMockClient({
      funds: { data: FUND_VFINX, error: null },
      funds_latest: { data: null, error: null },
    });
    const r = await resolveFundById("BW-FUND-S000004310");
    expect(r?.fund.bw_fund_id).toBe("BW-FUND-S000004310");
    expect(r?.latest).toBeNull();
  });
});

describe("resolveFundsByIds", () => {
  it("returns empty Map for empty input without hitting DB", async () => {
    const r = await resolveFundsByIds([]);
    expect(r.size).toBe(0);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it("merges funds + funds_latest by bw_fund_id", async () => {
    setMockClient({
      funds: { data: [FUND_VFINX], error: null },
      funds_latest: { data: [FUND_LATEST_VFINX], error: null },
    });
    const r = await resolveFundsByIds(["BW-FUND-S000004310"]);
    expect(r.size).toBe(1);
    expect(r.get("BW-FUND-S000004310")?.latest?.report_date).toBe(
      "2026-04-30",
    );
  });

  it("includes funds without latest rows", async () => {
    setMockClient({
      funds: { data: [FUND_VFINX], error: null },
      funds_latest: { data: [], error: null },
    });
    const r = await resolveFundsByIds(["BW-FUND-S000004310"]);
    expect(r.get("BW-FUND-S000004310")?.latest).toBeNull();
  });
});

describe("searchFunds", () => {
  it("returns rows when DB returns rows", async () => {
    setMockClient({ funds: { data: [FUND_VFINX], error: null } });
    const r = await searchFunds({ q: "VFINX", limit: 10 });
    expect(r.length).toBe(1);
    expect(r[0].ticker).toBe("VFINX");
  });

  it("clamps limit at 500 (does not throw)", async () => {
    setMockClient({ funds: { data: [], error: null } });
    const r = await searchFunds({ limit: 999_999 });
    expect(r).toEqual([]);
  });
});

describe("getStyleCellMembers", () => {
  it("returns just the bw_fund_id list", async () => {
    setMockClient({
      funds: {
        data: [
          { bw_fund_id: "BW-FUND-A" },
          { bw_fund_id: "BW-FUND-B" },
        ],
        error: null,
      },
    });
    const r = await getStyleCellMembers("Large Blend");
    expect(r).toEqual(["BW-FUND-A", "BW-FUND-B"]);
  });

  it("returns [] on error", async () => {
    setMockClient({
      funds: { data: null, error: { message: "fail" } },
    });
    const r = await getStyleCellMembers("Large Blend");
    expect(r).toEqual([]);
  });
});
