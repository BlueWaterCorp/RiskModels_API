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
import { readFundHoldingsBook, readFundHoldingsTopN } from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedGET } from "@/app/api/funds/[bw_fund_id]/holdings/route";

const GET = wrappedGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const FUND = {
  bw_fund_id: "BW-FUND-X",
  series_id: "SX",
  ticker: "VFINX",
  cik: null,
  fund_name: "Test Fund",
  morningstar_category: null,
  equity_style_9box: "Large Blend",
  style_link_method: null,
  net_expense_ratio: null,
  net_expense_ratio_asof: null,
  primary_bw_fund_id: null,
  latest_report_date: "2026-04-30",
  latest_filing_date: "2026-07-14",
  latest_extracted_at: null,
  latest_total_adj_mv: 1000,
  latest_n_holdings: 10,
  latest_effective_n: 5,
  last_in_eligible_universe_at: null,
  metadata: {},
};

const SNAPSHOT = {
  teo: "2026-04-30",
  aum_reported: 1_000_000,
  aum_erm3: 950_000,
  n_holdings_returned: 3,
  n_total_holdings: 503,
  holdings: [
    { bw_sym_id: "BW-A", adj_mv: 100_000, weight: 100_000 / 950_000 },
    { bw_sym_id: "BW-B", adj_mv: 50_000, weight: 50_000 / 950_000 },
    { bw_sym_id: "BW-C", adj_mv: 25_000, weight: 25_000 / 950_000 },
  ],
};

/** Full-book read: shorts included, dated by its own filing. */
const BOOK = {
  teo: "2026-06-30",
  filing_date: "2026-08-28",
  aum_reported: 1_000_000,
  aum_erm3: 25_000,
  net_assets: 1_000_000,
  weight_basis: "net_assets" as const,
  n_holdings_returned: 3,
  n_total_holdings: 605,
  holdings: [
    { bw_sym_id: "BW-A", ticker: "AAA", adj_mv: 100_000, weight: 0.1 },
    { bw_sym_id: "BW-B", ticker: "BBB", adj_mv: -90_000, weight: -0.09 },
    { bw_sym_id: "BW-C", ticker: null, adj_mv: 15_000, weight: 0.015 },
  ],
  book: {
    n_long: 313, n_short: 292, long_mv: 578e6, short_mv: -552e6, net_mv: 26e6, gross_mv: 1130e6,
    long_pct_nav: 0.97, short_pct_nav: -0.92, net_pct_nav: 0.04, gross_pct_nav: 1.89,
  },
  coverage: { n_positions: 605, n_with_ticker: 590, gross_with_ticker: 0.987, unmatched_mv: 0 },
};

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
  it("serves the full book with shorts, dated by its own filing", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsBook).mockResolvedValue(BOOK);
    const res = await GET(req("/api/funds/BW-FUND-X/holdings?limit=5000"), fakeContext);
    expect(res.status).toBe(200);
    expect(vi.mocked(readFundHoldingsBook)).toHaveBeenCalledWith("BW-FUND-X", 5000);
    expect(vi.mocked(readFundHoldingsTopN)).not.toHaveBeenCalled();
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-06-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-08-28");
    const body = await res.json();
    expect(body.source).toBe("full_book");
    expect(body.book.n_short).toBe(292);
    expect(body.coverage).toMatchObject({ n_positions: 605, n_with_ticker: 590 });
    expect(body.holdings[1]).toMatchObject({ ticker: "BBB", adj_mv: -90_000 });
  });

  it("falls back to the top-25 table with headers; default limit 25", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    const res = await GET(
      req("/api/funds/BW-FUND-X/holdings"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-X",
      25,
    );
    const body = await res.json();
    expect(body.source).toBe("top_25_longs");
    expect(body.bw_fund_id).toBe("BW-FUND-X");
    expect(body.holdings).toHaveLength(3);
    expect(body.aum_erm3).toBe(950_000);
    expect(body.n_total_holdings).toBe(503);
  });

  it("forwards custom ?limit=50", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    await GET(
      req("/api/funds/BW-FUND-X/holdings?limit=50"),
      fakeContext,
    );
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-X",
      50,
    );
  });

  it("clamps limit at 5000", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    await GET(
      req("/api/funds/BW-FUND-X/holdings?limit=99999"),
      fakeContext,
    );
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-X",
      5000,
    );
  });

  it("rejects non-positive limit", async () => {
    const res = await GET(
      req("/api/funds/BW-FUND-X/holdings?limit=0"),
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
      req("/api/funds/BW-FUND-X/holdings"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No holdings panel available for this fund");
  });
});
