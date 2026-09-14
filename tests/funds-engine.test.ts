import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { resetFundListingContextCache } from "@/lib/dal/fund-lifecycle";
import {
  fetchFund,
  fetchFundLatest,
  fetchStyleCohortLatest,
  fetchStyleRankings,
  getStyleCellMembers,
  mergeFundRegistryWithLatest,
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
  not: () => QueryStub;
  gte: () => QueryStub;
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
  stub.not = () => stub;
  stub.gte = () => stub;
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
  net_expense_ratio: null,
  net_expense_ratio_asof: null,
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
  portfolio_style_return: 0,
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
  resetFundListingContextCache();
});

type FilterCall = [string, ...unknown[]];

/**
 * Per-call mock: each `from(table)` consumes the next queued result for that
 * table and records the filter calls made on that query.
 */
function setSequencedClient(byTable: Record<string, Result<unknown>[]>) {
  const queries: { table: string; calls: FilterCall[] }[] = [];
  vi.mocked(createAdminClient).mockReturnValue({
    from: (table: string) => {
      const queue = byTable[table];
      const result = queue?.shift();
      if (!result) throw new Error(`unmocked call on table: ${table}`);
      const rec = { table, calls: [] as FilterCall[] };
      queries.push(rec);
      const stub = makeQuery(result);
      for (const m of ["select", "eq", "in", "is", "not", "gte", "or", "order", "limit"] as const) {
        const orig = stub[m];
        (stub as unknown as Record<string, (...a: unknown[]) => QueryStub>)[m] = (
          ...a: unknown[]
        ) => {
          rec.calls.push([m, ...a]);
          return (orig as () => QueryStub)();
        };
      }
      return stub;
    },
  } as never);
  return queries;
}

const PROBE_ACTIVE = { data: [{ status: "active", latest_report_date: "2026-06-30" }], error: null };
const PROBE_NO_COLUMN = {
  data: null,
  error: { code: "42703", message: "column funds.status does not exist" },
};

describe("active-fund read filter", () => {
  it("searchFunds applies status + report-date floor by default", async () => {
    const q = setSequencedClient({
      funds: [PROBE_ACTIVE, { data: [FUND_VFINX], error: null }],
      funds_latest: [{ data: [], error: null }],
    });
    const r = await searchFunds({ q: "VFINX" });
    expect(r).toHaveLength(1);
    const main = q.filter((x) => x.table === "funds")[1]!;
    expect(main.calls).toContainEqual(["eq", "status", "active"]);
    expect(main.calls).toContainEqual(["gte", "latest_report_date", "2025-05-26"]);
    expect(String(main.calls.find((c) => c[0] === "select")?.[1])).toContain("death_date");
  });

  it("searchFunds includeInactive skips the filter; includeEtfs=false drops ETFs", async () => {
    const q = setSequencedClient({
      funds: [PROBE_ACTIVE, { data: [], error: null }],
    });
    await searchFunds({ includeInactive: true, includeEtfs: false });
    const main = q.filter((x) => x.table === "funds")[1]!;
    expect(main.calls).not.toContainEqual(["eq", "status", "active"]);
    expect(main.calls).toContainEqual(["not", "is_etf", "is", true]);
  });

  it("falls back to no filter and base columns when status column is absent", async () => {
    const q = setSequencedClient({
      funds: [PROBE_NO_COLUMN, { data: [FUND_VFINX], error: null }],
      funds_latest: [{ data: [], error: null }],
    });
    const r = await searchFunds({ includeEtfs: false });
    expect(r).toHaveLength(1);
    const main = q.filter((x) => x.table === "funds")[1]!;
    expect(main.calls.map((c) => c[0])).not.toContain("gte");
    expect(main.calls.map((c) => c[0])).not.toContain("not");
    expect(String(main.calls.find((c) => c[0] === "select")?.[1])).not.toContain("status");
  });

  it("falls back to no filter when no fund has status='active' yet", async () => {
    const q = setSequencedClient({
      funds: [{ data: [], error: null }, { data: [], error: null }],
    });
    await getStyleCellMembers("Large Blend");
    const main = q.filter((x) => x.table === "funds")[1]!;
    expect(main.calls).not.toContainEqual(["eq", "status", "active"]);
  });

  it("direct lookup by id is not filtered and carries lifecycle fields", async () => {
    const dead = {
      ...FUND_VFINX,
      status: "delisted",
      death_date: "2019-12-31",
      latest_report_date: "2019-09-30",
    };
    const q = setSequencedClient({
      funds: [PROBE_ACTIVE, { data: dead, error: null }],
      funds_latest: [{ data: null, error: null }],
    });
    const r = await fetchFund("BW-FUND-S000004310");
    expect(r?.status).toBe("delisted");
    expect(r?.death_date).toBe("2019-12-31");
    expect(r?.latest_report_date).toBe("2019-09-30");
    const main = q.filter((x) => x.table === "funds")[1]!;
    expect(main.calls).not.toContainEqual(["eq", "status", "active"]);
  });

  it("fetchStyleRankings(fund) drops inactive funds and keeps stored ranks", async () => {
    const row = (rank: number, id: string) => ({
      rank,
      entity_id: id,
      metric: "portfolio_gross_return",
      value: 0.1,
      cohort_size: 100,
      period_window: "12m" as const,
      weighting: "ew" as const,
      report_date: "2026-04-30",
      filing_date_max: "2026-07-14",
    });
    setSequencedClient({
      funds: [
        PROBE_ACTIVE,
        { data: [{ bw_fund_id: "BW-FUND-A" }, { bw_fund_id: "BW-FUND-C" }], error: null },
      ],
      style_rankings_top: [
        { data: [], error: null },
        { data: [row(1, "BW-FUND-A"), row(2, "BW-FUND-DEAD"), row(3, "BW-FUND-C")], error: null },
      ],
    });
    const r = await fetchStyleRankings("Large Blend", {
      metric: "portfolio_gross_return",
      cohortType: "fund",
      periodWindow: "12m",
      limit: 2,
    });
    expect(r.map((x) => [x.rank, x.entity_id])).toEqual([
      [1, "BW-FUND-A"],
      [3, "BW-FUND-C"],
    ]);
  });

  it("fetchStyleRankings(fund) returns contiguous active ranks when populated", async () => {
    const base = {
      metric: "portfolio_gross_return",
      value: 0.1,
      cohort_size: 100,
      period_window: "12m" as const,
      weighting: "ew" as const,
      report_date: "2026-04-30",
      filing_date_max: "2026-07-14",
    };
    const q = setSequencedClient({
      style_rankings_top: [
        {
          data: [
            { ...base, rank: 1, entity_id: "BW-FUND-A", rank_active: 1, cohort_size_active: 40 },
            { ...base, rank: 3, entity_id: "BW-FUND-C", rank_active: 2, cohort_size_active: 40 },
          ],
          error: null,
        },
      ],
    });
    const r = await fetchStyleRankings("Large Blend", {
      metric: "portfolio_gross_return",
      cohortType: "fund",
      periodWindow: "12m",
    });
    expect(r.map((x) => [x.rank, x.entity_id, x.cohort_size])).toEqual([
      [1, "BW-FUND-A", 40],
      [2, "BW-FUND-C", 40],
    ]);
    expect(r[0]).not.toHaveProperty("rank_active");
    expect(q[0]!.calls).toContainEqual(["order", "rank_active", { ascending: true }]);
    expect(q.some((x) => x.table === "funds")).toBe(false);
  });

  it("fetchStyleRankings(fund, includeEtfs=false) orders by rank_active_ex_etf", async () => {
    const q = setSequencedClient({
      style_rankings_top: [
        {
          data: [{
            rank: 2, entity_id: "BW-FUND-B", metric: "m", value: 0.2, cohort_size: 100,
            period_window: "1m", weighting: "ew", report_date: "2026-04-30", filing_date_max: null,
            rank_active_ex_etf: 1, cohort_size_active_ex_etf: 30,
          }],
          error: null,
        },
      ],
    });
    const r = await fetchStyleRankings("Large Blend", { metric: "m", cohortType: "fund", includeEtfs: false });
    expect(r.map((x) => [x.rank, x.cohort_size])).toEqual([[1, 30]]);
    expect(q[0]!.calls).toContainEqual(["not", "rank_active_ex_etf", "is", null]);
  });

  it("fetchStyleRankings(fund, includeInactive) keeps stored ranks", async () => {
    const q = setSequencedClient({
      funds: [PROBE_ACTIVE],
      style_rankings_top: [{ data: [], error: null }],
    });
    await fetchStyleRankings("Large Blend", { metric: "m", cohortType: "fund", includeInactive: true });
    const calls = q.filter((x) => x.table === "style_rankings_top")[0]!.calls;
    expect(calls).toContainEqual(["order", "rank", { ascending: true }]);
  });

  it("fetchStyleRankings(symbol) never consults the funds table", async () => {
    setSequencedClient({
      style_rankings_top: [{ data: [], error: null }],
    });
    const r = await fetchStyleRankings("Large Blend", {
      metric: "weight",
      cohortType: "symbol",
    });
    expect(r).toEqual([]);
  });
});

describe("fetchFund", () => {
  it("returns the row when found", async () => {
    setMockClient({
      funds: { data: FUND_VFINX, error: null },
      funds_latest: { data: FUND_LATEST_VFINX, error: null },
    });
    const r = await fetchFund("BW-FUND-S000004310");
    expect(r?.bw_fund_id).toBe("BW-FUND-S000004310");
    expect(r?.ticker).toBe("VFINX");
  });

  it("returns null on error", async () => {
    setMockClient({
      funds: { data: null, error: { message: "boom" } },
      funds_latest: { data: null, error: null },
    });
    const r = await fetchFund("BW-FUND-MISSING");
    expect(r).toBeNull();
  });

  it("returns null when no row", async () => {
    setMockClient({
      funds: { data: null, error: null },
      funds_latest: { data: null, error: null },
    });
    const r = await fetchFund("BW-FUND-MISSING");
    expect(r).toBeNull();
  });

  it("coalesces latest_total_adj_mv from funds_latest when registry MV is 0", async () => {
    setMockClient({
      funds: {
        data: { ...FUND_VFINX, latest_total_adj_mv: 0 },
        error: null,
      },
      funds_latest: { data: FUND_LATEST_VFINX, error: null },
    });
    const r = await fetchFund("BW-FUND-S000004310");
    expect(r?.latest_total_adj_mv).toBe(25_000_000_000);
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
    setMockClient({
      funds: { data: [FUND_VFINX], error: null },
      funds_latest: { data: [], error: null },
    });
    const r = await searchFunds({ q: "VFINX", limit: 10 });
    expect(r.length).toBe(1);
    expect(r[0].ticker).toBe("VFINX");
  });

  it("clamps limit at 500 (does not throw)", async () => {
    setMockClient({
      funds: { data: [], error: null },
      funds_latest: { data: [], error: null },
    });
    const r = await searchFunds({ limit: 999_999 });
    expect(r).toEqual([]);
  });
});

describe("mergeFundRegistryWithLatest", () => {
  it("fills zero registry MV from latest.total_adj_mv", () => {
    const merged = mergeFundRegistryWithLatest(
      { ...FUND_VFINX, latest_total_adj_mv: 0 },
      FUND_LATEST_VFINX,
    );
    expect(merged.latest_total_adj_mv).toBe(25_000_000_000);
  });

  it("does not overwrite non-zero registry MV", () => {
    const merged = mergeFundRegistryWithLatest(FUND_VFINX, {
      ...FUND_LATEST_VFINX,
      total_adj_mv: 99,
    });
    expect(merged.latest_total_adj_mv).toBe(25_000_000_000);
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

const STYLE_LB_EW = {
  equity_style_9box: "Large Blend",
  weighting: "ew" as const,
  report_date: "2026-04-30",
  filing_date_max: "2026-07-14",
  extracted_at: "2026-05-02T16:41:31.441605+00:00",
  portfolio_gross_return: 0.071,
  portfolio_market_return: 0.099,
  portfolio_sector_return: -0.01,
  portfolio_subsector_return: -0.01,
  portfolio_style_return: 0,
  portfolio_idiosyncratic_return: -0.005,
  identity_residual: -0.003,
  weight_sum: 0.99,
  n_holdings_active: 2325,
  effective_n: 65.2,
  top10_weight_sum: 0.34,
  n_funds_in_cell: 1234,
  model_version: "funds_dag.v20260502",
  last_synced_at: "2026-05-02T16:41:31.441605+00:00",
  metadata: {},
};
const STYLE_LB_MV = { ...STYLE_LB_EW, weighting: "mv" as const };

describe("fetchStyleCohortLatest", () => {
  it("returns both EW and MV rows when present", async () => {
    setMockClient({
      style_portfolios_latest: { data: [STYLE_LB_EW, STYLE_LB_MV], error: null },
    });
    const r = await fetchStyleCohortLatest("Large Blend");
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.weighting).sort()).toEqual(["ew", "mv"]);
  });

  it("returns [] on error", async () => {
    setMockClient({
      style_portfolios_latest: { data: null, error: { message: "boom" } },
    });
    const r = await fetchStyleCohortLatest("Large Blend");
    expect(r).toEqual([]);
  });
});

describe("fetchStyleRankings", () => {
  const RANK_ROW = {
    rank: 1,
    entity_id: "BW-BBG000BPH459",
    metric: "weight",
    value: 0.04,
    cohort_size: 3469,
    period_window: "1m" as const,
    weighting: "mv" as const,
    report_date: "2026-04-30",
    filing_date_max: "2026-07-14",
  };

  it("returns ranked rows for valid params", async () => {
    setMockClient({
      style_rankings_top: { data: [RANK_ROW], error: null },
    });
    const r = await fetchStyleRankings("Large Blend", {
      metric: "weight",
      cohortType: "symbol",
    });
    expect(r).toHaveLength(1);
    expect(r[0].entity_id).toBe("BW-BBG000BPH459");
  });

  it("clamps limit at 50 and returns []", async () => {
    setMockClient({
      style_rankings_top: { data: [], error: null },
    });
    const r = await fetchStyleRankings("Large Blend", {
      metric: "weight",
      cohortType: "symbol",
      limit: 999,
    });
    expect(r).toEqual([]);
  });

  it("returns [] on error", async () => {
    setMockClient({
      style_rankings_top: { data: null, error: { message: "boom" } },
    });
    const r = await fetchStyleRankings("Large Blend", {
      metric: "weight",
      cohortType: "symbol",
    });
    expect(r).toEqual([]);
  });
});
