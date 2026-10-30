import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  fetchFund: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readFundHoldingsBook: vi.fn(),
  readFundHoldingsTopN: vi.fn(),
}));

import { fetchFund } from "@/lib/dal/funds-engine";
import {
  readFundHoldingsBook,
  readFundHoldingsTopN,
  type FundHoldingsBook,
} from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedGET } from "@/app/api/funds/[bw_fund_id]/holdings/route";

const GET = wrappedGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const FUND = {
  bw_fund_id: "BW-FUND-S000006037",
  series_id: "S000006037",
  ticker: "FCNTX",
  cik: null,
  fund_name: "Contrafund",
  morningstar_category: null,
  equity_style_9box: "Large Blend",
  style_link_method: null,
  net_expense_ratio: null,
  net_expense_ratio_asof: null,
  primary_bw_fund_id: null,
  latest_report_date: "2020-06-30",
  latest_filing_date: "2020-08-20",
  latest_extracted_at: null,
  latest_total_adj_mv: 114_036_000_000,
  latest_n_holdings: 224,
  latest_effective_n: null,
  last_in_eligible_universe_at: null,
  metadata: {},
};

const SNAPSHOT = {
  teo: "2020-06-30",
  aum_reported: 121_367_000_000,
  aum_erm3: 114_036_000_000,
  n_holdings_returned: 1,
  n_total_holdings: 224,
  holdings: [
    {
      bw_sym_id: "BW-BBG000BVPV84",
      adj_mv: 11_280_000_000,
      weight: 11_280_000_000 / 121_367_000_000,
    },
  ],
};

/** Full-book read: shorts included, dated by its own filing. */
const BOOK = {
  teo: "2020-06-30",
  report_date: "2020-06-30",
  time_basis: "report_date" as const,
  filing_date: "2020-08-20",
  filing_date_source: "exact",
  has_new_data: true,
  book_rows: 278,
  universe_dropped_mv: 174_000_000,
  ticker_as_of: "current_registry" as const,
  aum_reported: 121_367_000_000,
  aum_erm3: 114_036_000_000,
  net_assets: 121_367_000_000,
  weight_basis: "net_assets" as const,
  n_holdings_returned: 1,
  n_total_holdings: 224,
  holdings: [
    {
      bw_sym_id: "BW-BBG000BVPV84",
      ticker: "AMZN",
      adj_mv: 11_280_000_000,
      weight: 11_280_000_000 / 121_367_000_000,
    },
  ],
  book: {
    n_long: 224,
    long_mv: 114_036_000_000,
  },
  coverage: {
    n_positions: 224,
    unmatched_mv: 6_661_000_000,
  },
} as unknown as FundHoldingsBook;

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-holdings",
  costUsd: 0.005,
  startTime: Date.now(),
  rawFieldsPermitted: true,
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(fetchFund).mockReset();
  vi.mocked(readFundHoldingsTopN).mockReset();
  vi.mocked(readFundHoldingsBook).mockReset();
  vi.mocked(readFundHoldingsBook).mockResolvedValue(null);
});

describe("GET /api/funds/[bw_fund_id]/holdings", () => {
  it("serves the full book with point-in-time metadata", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsBook).mockResolvedValue(BOOK);
    const res = await GET(req("/api/funds/BW-FUND-S000006037/holdings?limit=1"), fakeContext);
    expect(res.status).toBe(200);
    expect(vi.mocked(readFundHoldingsBook)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      1,
      undefined,
      "report_date",
    );
    expect(vi.mocked(readFundHoldingsTopN)).not.toHaveBeenCalled();
    expect(res.headers.get("X-Data-As-Of")).toBe("2020-06-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2020-08-20");
    const body = await res.json();
    expect(body.source).toBe("full_book");
    expect(body).toMatchObject({
      report_date: "2020-06-30",
      filing_date: "2020-08-20",
      filing_date_source: "exact",
      time_basis: "report_date",
      has_new_data: true,
      book_rows: 278,
      universe_dropped_mv: 174_000_000,
      ticker_as_of: "current_registry",
      weight_basis: "net_assets",
    });
    expect(body.coverage.unmatched_mv).toBe(6_661_000_000);
    expect(body.n_total_holdings).toBe(224);
    expect(body.coverage.n_positions).toBe(224);
    expect(body.holdings[0].weight).toBeCloseTo(11.28 / 121.367);
  });

  it("falls back to the top-25 table with headers; default limit 25", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2020-06-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2020-08-20");
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      25,
    );
    const body = await res.json();
    expect(body.source).toBe("top_25_longs");
    expect(body.bw_fund_id).toBe("BW-FUND-S000006037");
    expect(body.holdings).toHaveLength(1);
    expect(body.aum_erm3).toBe(114_036_000_000);
    expect(body.n_total_holdings).toBe(224);
  });

  it("forwards custom ?limit=50", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?limit=50"),
      fakeContext,
    );
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      50,
    );
  });

  it("clamps limit at 5000", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?limit=99999"),
      fakeContext,
    );
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      5000,
    );
  });

  it("rejects non-positive limit", async () => {
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?limit=0"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchFund)).not.toHaveBeenCalled();
  });

  it("returns 404 when fund registry row missing", async () => {
    vi.mocked(fetchFund).mockResolvedValue(null);
    const res = await GET(
      req("/api/funds/BW-FUND-MISSING/holdings"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(readFundHoldingsTopN)).not.toHaveBeenCalled();
  });

  it("returns 404 when neither the book nor the table has holdings", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(null);
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No holdings panel available for this fund");
  });

  it("passes dated report-date selection to the full-book reader", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsBook).mockResolvedValue(BOOK);
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?as_of=2020-06-30&time_basis=report_date"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(readFundHoldingsBook)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      25,
      "2020-06-30",
      "report_date",
    );
  });

  it("returns 404 before the first eligible filing and never uses the latest fallback", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    const res = await GET(
      req(
        "/api/funds/BW-FUND-S000006037/holdings?as_of=2020-03-01&time_basis=available_date",
      ),
      fakeContext,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(readFundHoldingsBook)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      25,
      "2020-03-01",
      "available_date",
    );
    expect(vi.mocked(readFundHoldingsTopN)).not.toHaveBeenCalled();
  });

  it("rejects as_of without time_basis and explains the two choices", async () => {
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?as_of=2020-06-30"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "time_basis is required when as_of is set",
      code: "time_basis_required",
    });
    expect(Object.keys(body.options)).toEqual(["report_date", "available_date"]);
    expect(body.examples).toContain("?as_of=2020-06-30&time_basis=available_date");
    expect(vi.mocked(fetchFund)).not.toHaveBeenCalled();
  });

  it.each([
    ["as_of=2020-02-30", "as_of must be YYYY-MM-DD"],
    ["time_basis=filing", "time_basis must be report_date or available_date"],
  ])("rejects an invalid query value: %s", async (query, error) => {
    const res = await GET(
      req(`/api/funds/BW-FUND-S000006037/holdings?${query}`),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error });
    expect(vi.mocked(fetchFund)).not.toHaveBeenCalled();
  });
});
