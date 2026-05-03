import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  fetchFund: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readFundPortfolioSeries: vi.fn(),
}));

import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundPortfolioSeries } from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedGET } from "@/app/api/funds/[bw_fund_id]/portfolio/route";

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

const ROW = (teo: string) => ({
  teo,
  portfolio_gross_return: 0.05,
  portfolio_market_return: 0.04,
  portfolio_sector_return: 0.005,
  portfolio_subsector_return: 0.003,
  portfolio_idiosyncratic_return: 0.002,
  identity_residual: null,
  weight_sum: 0.99,
  n_holdings_active: 503,
  effective_n: 102.4,
  top10_weight_sum: 0.34,
});

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-portfolio-history",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(fetchFund).mockReset();
  vi.mocked(readFundPortfolioSeries).mockReset();
});

describe("GET /api/funds/[bw_fund_id]/portfolio", () => {
  it("returns 200 with rows + summary when both DALs return data", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundPortfolioSeries).mockResolvedValue([
      ROW("2026-02-29"),
      ROW("2026-03-31"),
      ROW("2026-04-30"),
    ]);
    const res = await GET(
      req("/api/funds/BW-FUND-X/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    const body = await res.json();
    expect(body.bw_fund_id).toBe("BW-FUND-X");
    expect(body.ticker).toBe("VFINX");
    expect(body.n_periods).toBe(3);
    expect(body.start_teo).toBe("2026-02-29");
    expect(body.end_teo).toBe("2026-04-30");
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0].portfolio_gross_return).toBeCloseTo(0.05);
  });

  it("returns 404 when fund registry row missing (skips zarr open)", async () => {
    vi.mocked(fetchFund).mockResolvedValue(null);
    const res = await GET(
      req("/api/funds/BW-FUND-MISSING/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(readFundPortfolioSeries)).not.toHaveBeenCalled();
  });

  it("returns 404 when zarr returns empty rows (registry exists)", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundPortfolioSeries).mockResolvedValue([]);
    const res = await GET(
      req("/api/funds/BW-FUND-X/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No portfolio history available for this fund");
  });

  it("forwards start_date / end_date to the DAL", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundPortfolioSeries).mockResolvedValue([ROW("2026-04-30")]);
    await GET(
      req(
        "/api/funds/BW-FUND-X/portfolio?start_date=2026-01-31&end_date=2026-04-30",
      ),
      fakeContext,
    );
    expect(vi.mocked(readFundPortfolioSeries)).toHaveBeenCalledWith(
      "BW-FUND-X",
      { startDate: "2026-01-31", endDate: "2026-04-30" },
    );
  });

  it("rejects malformed date params", async () => {
    const res = await GET(
      req("/api/funds/BW-FUND-X/portfolio?start_date=01-31-2026"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchFund)).not.toHaveBeenCalled();
  });

  it("rejects start_date > end_date", async () => {
    const res = await GET(
      req(
        "/api/funds/BW-FUND-X/portfolio?start_date=2026-04-30&end_date=2026-01-31",
      ),
      fakeContext,
    );
    expect(res.status).toBe(400);
  });
});
