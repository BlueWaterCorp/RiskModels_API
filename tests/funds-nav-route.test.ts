import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  fetchFund: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readFundNavSeries: vi.fn(),
}));

import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundNavSeries } from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedGET } from "@/app/api/funds/[bw_fund_id]/nav/route";

const GET = wrappedGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const FUND = {
  bw_fund_id: "BW-FUND-S000001243",
  series_id: "S000001243",
  ticker: "NOLCX",
  cik: "0000916620",
  fund_name: "Northern Large Cap Core Fund",
  morningstar_category: null,
  equity_style_9box: "Large Blend",
  style_link_method: null,
  primary_bw_fund_id: null,
  latest_report_date: "2026-04-30",
  latest_filing_date: "2026-07-14",
  latest_extracted_at: null,
  latest_total_adj_mv: 1000,
  latest_n_holdings: 100,
  latest_effective_n: 50,
  last_in_eligible_universe_at: null,
  metadata: {},
};

const ROW = (teo: string, close: number, ret: number | null) => ({
  teo,
  nav_close: close,
  nav_return_monthly: ret,
});

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-nav-history",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(fetchFund).mockReset();
  vi.mocked(readFundNavSeries).mockReset();
});

describe("GET /api/funds/[bw_fund_id]/nav", () => {
  it("returns 200 with rows + summary when both DALs return data", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundNavSeries).mockResolvedValue([
      ROW("2026-02-29", 100.0, 0.02),
      ROW("2026-03-31", 102.0, 0.02),
      ROW("2026-04-30", 99.0, -0.0294),
    ]);
    const res = await GET(
      req("/api/funds/BW-FUND-S000001243/nav"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    const body = await res.json();
    expect(body.bw_fund_id).toBe("BW-FUND-S000001243");
    expect(body.ticker).toBe("NOLCX");
    expect(body.fund_name).toBe("Northern Large Cap Core Fund");
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.n_periods).toBe(3);
    expect(body.start_teo).toBe("2026-02-29");
    expect(body.end_teo).toBe("2026-04-30");
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0].nav_close).toBeCloseTo(100.0);
    expect(body.rows[0].nav_return_monthly).toBeCloseTo(0.02);
  });

  it("returns 404 when fund registry row missing (skips zarr open)", async () => {
    vi.mocked(fetchFund).mockResolvedValue(null);
    const res = await GET(
      req("/api/funds/BW-FUND-MISSING/nav"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(readFundNavSeries)).not.toHaveBeenCalled();
  });

  it("returns 404 when zarr returns empty rows (registry exists)", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundNavSeries).mockResolvedValue([]);
    const res = await GET(
      req("/api/funds/BW-FUND-S000001243/nav"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No NAV history available for this fund");
  });

  it("forwards start_date / end_date to the DAL", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundNavSeries).mockResolvedValue([
      ROW("2026-04-30", 99.0, null),
    ]);
    await GET(
      req(
        "/api/funds/BW-FUND-S000001243/nav?start_date=2026-01-31&end_date=2026-04-30",
      ),
      fakeContext,
    );
    expect(vi.mocked(readFundNavSeries)).toHaveBeenCalledWith(
      "BW-FUND-S000001243",
      { startDate: "2026-01-31", endDate: "2026-04-30" },
    );
  });

  it("rejects malformed date params", async () => {
    const res = await GET(
      req("/api/funds/BW-FUND-S000001243/nav?start_date=01-31-2026"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchFund)).not.toHaveBeenCalled();
  });

  it("rejects start_date > end_date", async () => {
    const res = await GET(
      req(
        "/api/funds/BW-FUND-S000001243/nav?start_date=2026-04-30&end_date=2026-01-31",
      ),
      fakeContext,
    );
    expect(res.status).toBe(400);
  });
});
