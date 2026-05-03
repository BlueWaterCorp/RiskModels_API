import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readStyleCohortPortfolioSeries: vi.fn(),
  readStyleCohortHoldingsTopN: vi.fn(),
}));

import {
  readStyleCohortPortfolioSeries,
  readStyleCohortHoldingsTopN,
} from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedPortfolioGET } from "@/app/api/funds/style/[slug]/portfolio/route";
import { GET as wrappedHoldingsGET } from "@/app/api/funds/style/[slug]/holdings/route";

const portfolioGET = wrappedPortfolioGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;
const holdingsGET = wrappedHoldingsGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "style-cohort-portfolio-history",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

const PORTFOLIO_ROW = (teo: string) => ({
  teo,
  ew: {
    portfolio_gross_return: 0.071,
    portfolio_market_return: 0.099,
    portfolio_sector_return: -0.01,
    portfolio_subsector_return: -0.01,
    portfolio_idiosyncratic_return: -0.005,
    identity_residual: -0.003,
    weight_sum: 0.99,
    n_holdings_active: 2325,
    effective_n: 65.2,
    top10_weight_sum: 0.34,
  },
  mv: {
    portfolio_gross_return: 0.082,
    portfolio_market_return: 0.105,
    portfolio_sector_return: -0.012,
    portfolio_subsector_return: -0.008,
    portfolio_idiosyncratic_return: -0.003,
    identity_residual: 0,
    weight_sum: 1,
    n_holdings_active: 2325,
    effective_n: 50.1,
    top10_weight_sum: 0.42,
  },
});

beforeEach(() => {
  vi.mocked(readStyleCohortPortfolioSeries).mockReset();
  vi.mocked(readStyleCohortHoldingsTopN).mockReset();
});

describe("GET /api/funds/style/[slug]/portfolio", () => {
  it("returns 200 with cohort time series and bitemporal header", async () => {
    vi.mocked(readStyleCohortPortfolioSeries).mockResolvedValue([
      PORTFOLIO_ROW("2026-02-29"),
      PORTFOLIO_ROW("2026-03-31"),
      PORTFOLIO_ROW("2026-04-30"),
    ]);
    const res = await portfolioGET(
      req("/api/funds/style/large-blend/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(vi.mocked(readStyleCohortPortfolioSeries)).toHaveBeenCalledWith(
      "Large_Blend",
      { startDate: undefined, endDate: undefined },
    );
    const body = await res.json();
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.n_periods).toBe(3);
    expect(body.rows[2].mv.portfolio_gross_return).toBeCloseTo(0.082);
  });

  it("forwards date params (and sends Large_Blend, not Large Blend)", async () => {
    vi.mocked(readStyleCohortPortfolioSeries).mockResolvedValue([
      PORTFOLIO_ROW("2026-04-30"),
    ]);
    await portfolioGET(
      req("/api/funds/style/small-value/portfolio?start_date=2026-01-31&end_date=2026-04-30"),
      fakeContext,
    );
    expect(vi.mocked(readStyleCohortPortfolioSeries)).toHaveBeenCalledWith(
      "Small_Value",
      { startDate: "2026-01-31", endDate: "2026-04-30" },
    );
  });

  it("rejects unknown slug", async () => {
    const res = await portfolioGET(
      req("/api/funds/style/mega-blend/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(readStyleCohortPortfolioSeries)).not.toHaveBeenCalled();
  });

  it("rejects malformed start_date", async () => {
    const res = await portfolioGET(
      req("/api/funds/style/large-blend/portfolio?start_date=01-31-2026"),
      fakeContext,
    );
    expect(res.status).toBe(400);
  });

  it("rejects start_date > end_date", async () => {
    const res = await portfolioGET(
      req(
        "/api/funds/style/large-blend/portfolio?start_date=2026-04-30&end_date=2026-01-31",
      ),
      fakeContext,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when zarr returns []", async () => {
    vi.mocked(readStyleCohortPortfolioSeries).mockResolvedValue([]);
    const res = await portfolioGET(
      req("/api/funds/style/large-blend/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(404);
  });
});

const HOLDINGS_SNAPSHOT = {
  teo: "2026-04-30",
  weighting: "mv" as const,
  n_returned: 2,
  n_total_holdings: 503,
  holdings: [
    {
      bw_sym_id: "BW-A",
      weight: 0.05,
      contribution_gross: 0.004,
      contribution_market: 0.0035,
      contribution_sector: 0.0003,
      contribution_subsector: 0.0001,
      contribution_idiosyncratic: 0.0001,
      n_funds_holding: 540,
    },
    {
      bw_sym_id: "BW-B",
      weight: 0.03,
      contribution_gross: 0.002,
      contribution_market: 0.0018,
      contribution_sector: 0.0001,
      contribution_subsector: 0.0,
      contribution_idiosyncratic: 0.0001,
      n_funds_holding: 380,
    },
  ],
};

describe("GET /api/funds/style/[slug]/holdings", () => {
  const holdCtx: BillingContext = { ...fakeContext, capabilityId: "style-cohort-holdings" };

  it("returns 200 with top-N + bitemporal header; default weighting=mv, limit=25", async () => {
    vi.mocked(readStyleCohortHoldingsTopN).mockResolvedValue(HOLDINGS_SNAPSHOT);
    const res = await holdingsGET(
      req("/api/funds/style/large-blend/holdings"),
      holdCtx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(vi.mocked(readStyleCohortHoldingsTopN)).toHaveBeenCalledWith(
      "Large_Blend",
      { weighting: "mv", n: 25 },
    );
    const body = await res.json();
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.holdings).toHaveLength(2);
    expect(body.weighting).toBe("mv");
  });

  it("forwards ?weighting=ew + clamps limit at 100", async () => {
    vi.mocked(readStyleCohortHoldingsTopN).mockResolvedValue(HOLDINGS_SNAPSHOT);
    await holdingsGET(
      req("/api/funds/style/large-blend/holdings?weighting=ew&limit=999"),
      holdCtx,
    );
    expect(vi.mocked(readStyleCohortHoldingsTopN)).toHaveBeenCalledWith(
      "Large_Blend",
      { weighting: "ew", n: 100 },
    );
  });

  it("rejects invalid weighting", async () => {
    const res = await holdingsGET(
      req("/api/funds/style/large-blend/holdings?weighting=cap"),
      holdCtx,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(readStyleCohortHoldingsTopN)).not.toHaveBeenCalled();
  });

  it("rejects unknown slug", async () => {
    const res = await holdingsGET(
      req("/api/funds/style/mega-blend/holdings"),
      holdCtx,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when zarr returns null", async () => {
    vi.mocked(readStyleCohortHoldingsTopN).mockResolvedValue(null);
    const res = await holdingsGET(
      req("/api/funds/style/large-blend/holdings"),
      holdCtx,
    );
    expect(res.status).toBe(404);
  });
});
