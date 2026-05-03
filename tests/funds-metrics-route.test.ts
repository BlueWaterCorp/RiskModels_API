import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Make withBilling a passthrough so we can test the inner handler directly.
// The wrapper is exercised by integration / manual testing, not unit tests.
vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  resolveFundById: vi.fn(),
}));

import { resolveFundById } from "@/lib/dal/funds-engine";
import { GET as wrappedGET } from "@/app/api/funds/[bw_fund_id]/route";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import type { NextResponse } from "next/server";

// withBilling is mocked above to be identity, so the exported GET is really
// the inner (req, ctx) handler at runtime — but TypeScript still sees the
// wrapped 1-arg signature. Cast back to the inner shape for tests.
const GET = wrappedGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const FUND = {
  bw_fund_id: "BW-FUND-S000004310",
  series_id: "S000004310",
  ticker: "VFINX",
  cik: null,
  fund_name: "Vanguard 500 Index Fund",
  morningstar_category: "Large Blend",
  equity_style_9box: "Large Blend",
  style_link_method: "ticker_match",
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

const LATEST = {
  bw_fund_id: "BW-FUND-S000004310",
  report_date: "2026-04-30",
  filing_date: "2026-07-14",
  extracted_at: "2026-05-02T16:38:21.330085+00:00",
  portfolio_gross_return: 0.05,
  portfolio_market_return: 0.04,
  portfolio_sector_return: 0.005,
  portfolio_subsector_return: 0.003,
  portfolio_idiosyncratic_return: 0.002,
  identity_residual: null,
  weight_sum: 1,
  n_holdings_active: 10,
  effective_n: 5,
  top10_weight_sum: 0.5,
  total_adj_mv: 1000,
  equity_style_9box: "Large Blend",
  n_funds_in_cell_at_report_date: 100,
  model_version: "funds_dag.v20260502",
  factor_set_id: "uni_mc_3000_SPY",
  last_synced_at: "2026-05-02T16:41:31.441605+00:00",
  metadata: {},
};

const fakeContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-metrics",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(resolveFundById).mockReset();
});

describe("GET /api/funds/[bw_fund_id]", () => {
  it("returns 200 with shaped body and bitemporal headers", async () => {
    vi.mocked(resolveFundById).mockResolvedValue({ fund: FUND, latest: LATEST });
    const res = await GET(
      req("/api/funds/BW-FUND-S000004310"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    expect(res.headers.get("X-Risk-Model-Version")).toBe("funds_dag.v20260502");
    const body = await res.json();
    expect(body.bw_fund_id).toBe("BW-FUND-S000004310");
    expect(body.ticker).toBe("VFINX");
    expect(body.returns.gross).toBeCloseTo(0.05);
    expect(body.diagnostics.effective_n).toBe(5);
    expect(body._metadata.factor_set_id).toBe("uni_mc_3000_SPY");
  });

  it("returns 404 when DAL returns null", async () => {
    vi.mocked(resolveFundById).mockResolvedValue(null);
    const res = await GET(req("/api/funds/BW-FUND-MISSING"), fakeContext);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Fund not found");
  });

  it("returns 404 with hint when registry exists but no funds_latest row", async () => {
    vi.mocked(resolveFundById).mockResolvedValue({ fund: FUND, latest: null });
    const res = await GET(req("/api/funds/BW-FUND-S000004310"), fakeContext);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No funds_latest row for this fund");
    expect(body.bw_fund_id).toBe("BW-FUND-S000004310");
  });
});
