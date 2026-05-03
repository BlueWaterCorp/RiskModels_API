import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  fetchFund: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readFundHedgeLatest: vi.fn(),
}));

import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundHedgeLatest } from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedGET } from "@/app/api/funds/[bw_fund_id]/hedge/route";

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
  L1: [{ etf: "SPY", hr: 0.85 }],
  L2: [{ etf: "XLK", hr: 0.32 }, { etf: "XLF", hr: 0.18 }],
  L3: [{ etf: "SMH", hr: 0.15 }],
};

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-hedge",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(fetchFund).mockReset();
  vi.mocked(readFundHedgeLatest).mockReset();
});

describe("GET /api/funds/[bw_fund_id]/hedge", () => {
  it("returns 200 with per-level ETF lists + bitemporal headers", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHedgeLatest).mockResolvedValue(SNAPSHOT);
    const res = await GET(req("/api/funds/BW-FUND-X/hedge"), fakeContext);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    const body = await res.json();
    expect(body.bw_fund_id).toBe("BW-FUND-X");
    expect(body.teo).toBe("2026-04-30");
    expect(body.L1).toEqual([{ etf: "SPY", hr: 0.85 }]);
    expect(body.L2).toHaveLength(2);
    expect(body.L3[0].etf).toBe("SMH");
  });

  it("returns 404 when fund registry row missing", async () => {
    vi.mocked(fetchFund).mockResolvedValue(null);
    const res = await GET(
      req("/api/funds/BW-FUND-MISSING/hedge"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(readFundHedgeLatest)).not.toHaveBeenCalled();
  });

  it("returns 404 when zarr returns null (no hedge panel)", async () => {
    vi.mocked(fetchFund).mockResolvedValue(FUND);
    vi.mocked(readFundHedgeLatest).mockResolvedValue(null);
    const res = await GET(req("/api/funds/BW-FUND-X/hedge"), fakeContext);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No hedge ratio panel available for this fund");
  });
});
