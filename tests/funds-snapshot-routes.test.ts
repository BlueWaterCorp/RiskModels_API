import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/funds-engine", () => ({
  resolveFundById: vi.fn(),
  fetchFundCohortRanks: vi.fn(),
  fetchStyleCohortLatest: vi.fn(),
  fetchStyleRankings: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readFundHoldingsTopN: vi.fn(),
  readFundHedgeLatest: vi.fn(),
  readFundPortfolioSeries: vi.fn(),
  readStyleCohortHoldingsTopN: vi.fn(),
  readStyleCohortPortfolioSeries: vi.fn(),
}));

import {
  fetchFundCohortRanks,
  fetchStyleCohortLatest,
  fetchStyleRankings,
  resolveFundById,
} from "@/lib/dal/funds-engine";
import {
  readFundHedgeLatest,
  readFundHoldingsTopN,
  readFundPortfolioSeries,
  readStyleCohortHoldingsTopN,
  readStyleCohortPortfolioSeries,
} from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import type {
  FundLatestRow,
  FundRow,
  StylePortfolioRow,
  StyleRankingRow,
} from "@/lib/dal/funds-engine";

import { GET as wrappedFundSnapshotGET } from "@/app/api/funds/snapshot/[bw_fund_id]/route";
import { GET as wrappedCohortSnapshotGET } from "@/app/api/funds/style/[slug]/snapshot/route";

const fundSnapshotGET = wrappedFundSnapshotGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;
const cohortSnapshotGET = wrappedCohortSnapshotGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

function fixture<T>(name: string): T {
  const p = join(__dirname, "fixtures", "funds", name);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

const FUND = fixture<FundRow>("fund.json");
const LATEST = fixture<FundLatestRow>("funds_latest.json");
const FUND_COHORT_RANKS = fixture<StyleRankingRow[]>("fund_cohort_ranks.json");
const COHORT_METRICS = fixture<StylePortfolioRow[]>("cohort_metrics.json");
const COHORT_TOP_SYMBOLS = fixture<StyleRankingRow[]>("cohort_top_symbols.json");
const COHORT_TOP_FUNDS = fixture<StyleRankingRow[]>("cohort_top_funds.json");

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fund-snapshot-json",
  costUsd: 0.01,
  startTime: Date.now(),
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(resolveFundById).mockReset();
  vi.mocked(fetchFundCohortRanks).mockReset();
  vi.mocked(fetchStyleCohortLatest).mockReset();
  vi.mocked(fetchStyleRankings).mockReset();
  vi.mocked(readFundHoldingsTopN).mockReset();
  vi.mocked(readFundHedgeLatest).mockReset();
  vi.mocked(readFundPortfolioSeries).mockReset();
  vi.mocked(readStyleCohortHoldingsTopN).mockReset();
  vi.mocked(readStyleCohortPortfolioSeries).mockReset();
});

describe("GET /api/funds/snapshot/[bw_fund_id]", () => {
  it("returns 200 with composed snapshot + bitemporal headers (real fixture passthrough)", async () => {
    vi.mocked(resolveFundById).mockResolvedValue({ fund: FUND, latest: LATEST });
    vi.mocked(readFundHoldingsTopN).mockResolvedValue(null);
    vi.mocked(readFundHedgeLatest).mockResolvedValue(null);
    vi.mocked(readFundPortfolioSeries).mockResolvedValue([]);
    vi.mocked(fetchFundCohortRanks).mockResolvedValue(FUND_COHORT_RANKS);
    vi.mocked(fetchStyleCohortLatest).mockResolvedValue(COHORT_METRICS);

    const res = await fundSnapshotGET(
      req(`/api/funds/snapshot/${FUND.bw_fund_id}`),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe(LATEST.report_date);
    expect(res.headers.get("X-Data-Filing-Date")).toBe(LATEST.filing_date);
    const body = await res.json();
    expect(body.bw_fund_id).toBe(FUND.bw_fund_id);
    expect(body.ticker).toBe(FUND.ticker);
    expect(body.cohort_context.equity_style_9box).toBe("Large Blend");
    expect(body.cohort_context.ranks).toHaveLength(FUND_COHORT_RANKS.length);
  });

  it("returns 404 when fund not found", async () => {
    vi.mocked(resolveFundById).mockResolvedValue(null);
    const res = await fundSnapshotGET(
      req("/api/funds/snapshot/BW-FUND-MISSING"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(readFundHoldingsTopN)).not.toHaveBeenCalled();
  });

  it("returns 404 when registry exists but funds_latest missing", async () => {
    vi.mocked(resolveFundById).mockResolvedValue({ fund: FUND, latest: null });
    const res = await fundSnapshotGET(
      req(`/api/funds/snapshot/${FUND.bw_fund_id}`),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No funds_latest row for this fund");
  });
});

describe("GET /api/funds/style/[slug]/snapshot", () => {
  const cohortCtx: BillingContext = {
    ...fakeContext,
    capabilityId: "style-cohort-snapshot-json",
    costUsd: 0.005,
  };

  it("returns 200 with composed cohort snapshot + bitemporal headers", async () => {
    vi.mocked(fetchStyleCohortLatest).mockResolvedValue(COHORT_METRICS);
    vi.mocked(fetchStyleRankings)
      .mockResolvedValueOnce(COHORT_TOP_FUNDS)
      .mockResolvedValueOnce(COHORT_TOP_SYMBOLS);
    vi.mocked(readStyleCohortPortfolioSeries).mockResolvedValue([]);
    vi.mocked(readStyleCohortHoldingsTopN).mockResolvedValue(null);

    const res = await cohortSnapshotGET(
      req("/api/funds/style/large-blend/snapshot"),
      cohortCtx,
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(fetchStyleCohortLatest)).toHaveBeenCalledWith("Large Blend");
    expect(vi.mocked(fetchStyleRankings)).toHaveBeenCalledTimes(2);
    const body = await res.json();
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.slug).toBe("large-blend");
    expect(Object.keys(body.metrics.weightings).sort()).toEqual(["ew", "mv"]);
    expect(body.top_funds.rows).toHaveLength(COHORT_TOP_FUNDS.length);
    expect(body.top_symbols.rows).toHaveLength(COHORT_TOP_SYMBOLS.length);
  });

  it("returns 400 for invalid slug", async () => {
    const res = await cohortSnapshotGET(
      req("/api/funds/style/mega-blend/snapshot"),
      cohortCtx,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchStyleCohortLatest)).not.toHaveBeenCalled();
  });

  it("returns 404 when cohort metrics empty", async () => {
    vi.mocked(fetchStyleCohortLatest).mockResolvedValue([]);
    const res = await cohortSnapshotGET(
      req("/api/funds/style/large-blend/snapshot"),
      cohortCtx,
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(fetchStyleRankings)).not.toHaveBeenCalled();
  });
});
