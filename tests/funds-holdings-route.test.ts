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
  it("keeps the undated full-book response on the legacy shape", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsBook).mockResolvedValue(BOOK);
    const res = await GET(req("/api/funds/BW-FUND-S000006037/holdings?limit=1"), fakeContext);
    expect(res.status).toBe(200);
    expect(vi.mocked(readFundHoldingsBook)).toHaveBeenCalledWith(
      "BW-FUND-S000006037",
      1,
    );
    expect(vi.mocked(readFundHoldingsTopN)).not.toHaveBeenCalled();
    expect(res.headers.get("X-Data-As-Of")).toBe("2020-06-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2020-08-20");
    const body = await res.json();
    expect(body.source).toBe("full_book");
    expect(body).toMatchObject({
      filing_date: "2020-08-20",
      weight_basis: "net_assets",
    });
    for (const field of [
      "report_date",
      "filing_date_source",
      "time_basis",
      "has_new_data",
      "book_rows",
      "universe_dropped_mv",
      "ticker_as_of",
    ]) {
      expect(body).not.toHaveProperty(field);
    }
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
    const text = await res.text();
    expect(text).toBe(JSON.stringify({
      bw_fund_id: "BW-FUND-S000006037",
      ticker: "FCNTX",
      fund_name: "Contrafund",
      equity_style_9box: "Large Blend",
      source: "top_25_longs",
      ...SNAPSHOT,
    }));
    const body = JSON.parse(text);
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
    // The book's own filing date is shown even though it is after as_of.
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2020-08-20");
    const body = await res.json();
    expect(body.filing_date).toBe("2020-08-20");
    expect(body.report_date).toBe("2020-06-30");
    expect(body.time_basis).toBe("report_date");
  });

  it("uses only the selected dated book's filing stamp", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsBook).mockResolvedValue({
      ...BOOK,
      filing_date: "2020-05-26",
      report_date: "2020-03-31",
      time_basis: "available_date",
      teo: "2020-03-31",
    });
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?as_of=2020-06-30&time_basis=available_date"),
      fakeContext,
    );
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2020-05-26");
    expect(await res.json()).toMatchObject({
      filing_date: "2020-05-26",
      report_date: "2020-03-31",
    });
  });

  it("does not substitute the fund's latest filing stamp on a dated book", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsBook).mockResolvedValue({ ...BOOK, filing_date: null });
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?as_of=2020-08-01&time_basis=report_date"),
      fakeContext,
    );
    expect(res.headers.get("X-Data-Filing-Date")).toBeNull();
    expect((await res.json()).filing_date).toBeNull();
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

  it("rejects time_basis without as_of and explains that it only selects a dated book", async () => {
    const res = await GET(
      req("/api/funds/BW-FUND-S000006037/holdings?time_basis=available_date"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "as_of is required when time_basis is set",
      code: "as_of_required",
      detail: "time_basis only selects a dated book; include an as_of cutoff date.",
      example: "?as_of=2020-06-30&time_basis=available_date",
    });
    expect(vi.mocked(fetchFund)).not.toHaveBeenCalled();
  });

  it.each([
    ["as_of=2020-02-30", "as_of must be YYYY-MM-DD"],
    ["as_of=2020-06-30&time_basis=filing", "time_basis must be report_date or available_date"],
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
