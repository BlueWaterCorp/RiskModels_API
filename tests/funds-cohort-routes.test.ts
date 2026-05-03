import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  fetchStyleCohortLatest: vi.fn(),
  fetchStyleRankings: vi.fn(),
}));

import { fetchStyleCohortLatest, fetchStyleRankings } from "@/lib/dal/funds-engine";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedCohortGET } from "@/app/api/funds/style/[slug]/route";
import { GET as wrappedRankingsGET } from "@/app/api/funds/style/[slug]/rankings/[cohort_type]/route";

const cohortGET = wrappedCohortGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;
const rankingsGET = wrappedRankingsGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "style-cohort-metrics",
  costUsd: 0.005,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

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
const STYLE_LB_MV = {
  ...STYLE_LB_EW,
  weighting: "mv" as const,
  portfolio_gross_return: 0.082,
  effective_n: 50.1,
};

beforeEach(() => {
  vi.mocked(fetchStyleCohortLatest).mockReset();
  vi.mocked(fetchStyleRankings).mockReset();
});

describe("GET /api/funds/style/[slug]", () => {
  it("returns 200 with both EW + MV under weightings; bitemporal headers", async () => {
    vi.mocked(fetchStyleCohortLatest).mockResolvedValue([
      STYLE_LB_EW,
      STYLE_LB_MV,
    ]);
    const res = await cohortGET(req("/api/funds/style/large-blend"), fakeContext);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    expect(res.headers.get("X-Risk-Model-Version")).toBe("funds_dag.v20260502");
    expect(vi.mocked(fetchStyleCohortLatest)).toHaveBeenCalledWith("Large Blend");
    const body = await res.json();
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.slug).toBe("large-blend");
    expect(body.n_funds_in_cell).toBe(1234);
    expect(body.weightings.ew.portfolio_gross_return).toBeCloseTo(0.071);
    expect(body.weightings.mv.portfolio_gross_return).toBeCloseTo(0.082);
  });

  it("returns 400 for unknown slug; doesn't hit DAL", async () => {
    const res = await cohortGET(
      req("/api/funds/style/mega-blend"),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchStyleCohortLatest)).not.toHaveBeenCalled();
  });

  it("returns 404 when DAL returns no rows", async () => {
    vi.mocked(fetchStyleCohortLatest).mockResolvedValue([]);
    const res = await cohortGET(req("/api/funds/style/large-blend"), fakeContext);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/funds/style/[slug]/rankings/[cohort_type]", () => {
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

  const rankCtx: BillingContext = { ...fakeContext, capabilityId: "style-cohort-rankings" };

  it("returns 200 with rows + bitemporal headers; defaults applied", async () => {
    vi.mocked(fetchStyleRankings).mockResolvedValue([RANK_ROW]);
    const res = await rankingsGET(
      req("/api/funds/style/large-blend/rankings/symbol?metric=weight"),
      rankCtx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(vi.mocked(fetchStyleRankings)).toHaveBeenCalledWith("Large Blend", {
      metric: "weight",
      cohortType: "symbol",
      periodWindow: "1m",
      weighting: "mv",
      limit: 25,
    });
    const body = await res.json();
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.cohort_type).toBe("symbol");
    expect(body.period_window).toBe("1m");
    expect(body.weighting).toBe("mv");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].entity_id).toBe("BW-BBG000BPH459");
  });

  it("forwards custom params + clamps limit at 50", async () => {
    vi.mocked(fetchStyleRankings).mockResolvedValue([RANK_ROW]);
    await rankingsGET(
      req(
        "/api/funds/style/small-value/rankings/sector?metric=gross_return&period_window=12m&weighting=ew&limit=999",
      ),
      rankCtx,
    );
    expect(vi.mocked(fetchStyleRankings)).toHaveBeenCalledWith("Small Value", {
      metric: "gross_return",
      cohortType: "sector",
      periodWindow: "12m",
      weighting: "ew",
      limit: 50,
    });
  });

  it("rejects missing metric", async () => {
    const res = await rankingsGET(
      req("/api/funds/style/large-blend/rankings/symbol"),
      rankCtx,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchStyleRankings)).not.toHaveBeenCalled();
  });

  it("rejects invalid slug", async () => {
    const res = await rankingsGET(
      req("/api/funds/style/mega-blend/rankings/symbol?metric=weight"),
      rankCtx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid cohort_type", async () => {
    const res = await rankingsGET(
      req("/api/funds/style/large-blend/rankings/etf?metric=weight"),
      rankCtx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid period_window", async () => {
    const res = await rankingsGET(
      req("/api/funds/style/large-blend/rankings/symbol?metric=weight&period_window=2y"),
      rankCtx,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when DAL returns []", async () => {
    vi.mocked(fetchStyleRankings).mockResolvedValue([]);
    const res = await rankingsGET(
      req("/api/funds/style/large-blend/rankings/symbol?metric=weight"),
      rankCtx,
    );
    expect(res.status).toBe(404);
  });
});
