import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  fetchFund: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readFundHoldingsTopN: vi.fn(),
}));

import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundHoldingsTopN } from "@/lib/dal/funds-zarr-reader";
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

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-holdings",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(fetchFund).mockReset();
  vi.mocked(readFundHoldingsTopN).mockReset();
});

describe("GET /api/funds/[bw_fund_id]/holdings", () => {
  it("returns 200 with snapshot + bitemporal headers; default limit 25", async () => {
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

  it("clamps limit at 1000", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(SNAPSHOT);
    await GET(
      req("/api/funds/BW-FUND-X/holdings?limit=99999"),
      fakeContext,
    );
    expect(vi.mocked(readFundHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FUND-X",
      1000,
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

  it("returns 404 when zarr returns null (no holdings panel)", async () => {
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
