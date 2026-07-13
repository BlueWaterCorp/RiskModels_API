import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/filers-engine", () => ({
  fetchFiler: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  isSyntheticEntityId: (id: string) => id.startsWith("BW-SYNTH-"),
  readSyntheticEntityMeta: vi.fn(),
  readFilerHoldingsTopN: vi.fn(),
  readFilerPortfolioSeries: vi.fn(),
}));

vi.mock("@/lib/13f/enrich-filer-holdings", () => ({
  // Pass-through: enrichment must preserve the D.8.39 bitemporal fields.
  enrichFilerHoldingsWithL3: vi.fn(async (snap: unknown) => snap),
}));

import { fetchFiler } from "@/lib/dal/filers-engine";
import {
  readFilerHoldingsTopN,
  readFilerPortfolioSeries,
  type FilerPortfolioRow,
} from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as holdingsGETWrapped } from "@/app/api/13f/filers/[bw_filer_id]/holdings/route";
import { GET as portfolioGETWrapped } from "@/app/api/13f/filers/[bw_filer_id]/portfolio/route";

type RouteGET = (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;
const holdingsGET = holdingsGETWrapped as unknown as RouteGET;
const portfolioGET = portfolioGETWrapped as unknown as RouteGET;

const FILER = {
  bw_filer_id: "BW-FILER-X",
  cik: "0000123456",
  name: "Test Capital LP",
  filer_type: "hedge_fund",
  filer_subtype: null,
  aum_tier: "large",
  style_label: null,
  country: "US",
  status: "active",
  n_funds_managed: null,
  latest_report_date: "2026-03-31",
  latest_filing_date: "2026-05-14",
  latest_extracted_at: null,
  latest_aum_usd: 1_000_000_000,
};

const HOLDINGS_SNAPSHOT = {
  teo: "2026-03-31",
  report_date: "2026-03-31",
  filing_date: "2026-05-14",
  as_of_basis: "filing_date" as const,
  total_aum_usd: 1_000_000_000,
  aum_in_erm3: 900_000_000,
  n_holdings_returned: 2,
  n_total_holdings: 42,
  holdings: [
    { security_id: "BW-A", adj_mv: 600_000_000, weight: 0.6 },
    { security_id: "BW-B", adj_mv: 400_000_000, weight: 0.4 },
  ],
};

function portfolioRow(
  teo: string,
  filing_date: string | null,
): FilerPortfolioRow {
  return {
    teo,
    filing_date,
    weight_sum: 1,
    n_holdings_active: 42,
    effective_n: 10,
    top5_weight_sum: 0.5,
    top10_weight_sum: 0.7,
    weight_hhi: 0.1,
    total_aum_usd: 1_000_000_000,
    aum_in_erm3: 900_000_000,
    n_holdings_in_erm3: 40,
    effective_n_in_erm3: 9,
    coverage_in_erm3: 0.9,
    portfolio_style_hhi: null,
    effective_n_styles: null,
    portfolio_gross_return: null,
    portfolio_market_return: null,
    portfolio_sector_return: null,
    portfolio_subsector_return: null,
    portfolio_idiosyncratic_return: null,
    identity_residual: null,
  };
}

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "filer-holdings",
  costUsd: 0.005,
  startTime: Date.now(),
} as BillingContext;

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  vi.mocked(fetchFiler).mockReset();
  vi.mocked(readFilerHoldingsTopN).mockReset();
  vi.mocked(readFilerPortfolioSeries).mockReset();
});

describe("GET /api/13f/filers/[bw_filer_id]/holdings (D.8.39)", () => {
  it("serves bitemporal stamps as body fields + headers", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue(HOLDINGS_SNAPSHOT);

    const res = await holdingsGET(
      req("/api/13f/filers/BW-FILER-X/holdings"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report_date).toBe("2026-03-31");
    expect(body.filing_date).toBe("2026-05-14");
    expect(body.as_of).toBeUndefined();
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-03-31");
    // Per-snapshot filing_date wins over the filer's latest_filing_date.
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-05-14");
    expect(vi.mocked(readFilerHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FILER-X",
      25,
      undefined,
    );
  });

  it("passes as_of through to the reader and echoes it", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue({
      ...HOLDINGS_SNAPSHOT,
      teo: "2025-12-31",
      report_date: "2025-12-31",
      filing_date: "2026-02-13",
    });

    const res = await holdingsGET(
      req("/api/13f/filers/BW-FILER-X/holdings?as_of=2026-03-01"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.as_of).toBe("2026-03-01");
    expect(body.as_of_basis).toBe("filing_date");
    expect(body.report_date).toBe("2025-12-31");
    expect(body.filing_date).toBe("2026-02-13");
    expect(vi.mocked(readFilerHoldingsTopN)).toHaveBeenCalledWith(
      "BW-FILER-X",
      25,
      "2026-03-01",
    );
  });

  it("rejects malformed as_of with 400", async () => {
    const res = await holdingsGET(
      req("/api/13f/filers/BW-FILER-X/holdings?as_of=Q1-2026"),
      fakeContext,
    );
    expect(res.status).toBe(400);
  });

  it("404s with an as_of-specific message when nothing was known", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue(null);

    const res = await holdingsGET(
      req("/api/13f/filers/BW-FILER-X/holdings?as_of=2006-01-01"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/as of the requested date/);
    expect(body.as_of).toBe("2006-01-01");
  });
});

describe("GET /api/13f/filers/[bw_filer_id]/portfolio (D.8.39)", () => {
  const ROWS = [
    portfolioRow("2025-09-30", "2025-11-14"),
    portfolioRow("2025-12-31", "2026-02-13"),
    portfolioRow("2026-03-31", "2026-05-14"),
  ];

  it("rows carry filing_date; latest row drives X-Data-Filing-Date", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerPortfolioSeries).mockResolvedValue(ROWS);

    const res = await portfolioGET(
      req("/api/13f/filers/BW-FILER-X/portfolio"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0].filing_date).toBe("2025-11-14");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-05-14");
  });

  it("as_of filters knowledge-mode on filing_date", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerPortfolioSeries).mockResolvedValue(ROWS);

    const res = await portfolioGET(
      req("/api/13f/filers/BW-FILER-X/portfolio?as_of=2026-03-01"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // 2026-03-31 quarter was filed 2026-05-14 — not yet known on 2026-03-01.
    expect(body.n_periods).toBe(2);
    expect(body.end_teo).toBe("2025-12-31");
    expect(body.as_of).toBe("2026-03-01");
    expect(body.as_of_basis).toBe("filing_date");
    expect(res.headers.get("X-Data-As-Of")).toBe("2025-12-31");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-02-13");
  });

  it("falls back to report_date basis on pre-1.4 zarrs without filing dates", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerPortfolioSeries).mockResolvedValue(
      ROWS.map((r) => ({ ...r, filing_date: null })),
    );

    const res = await portfolioGET(
      req("/api/13f/filers/BW-FILER-X/portfolio?as_of=2026-01-15"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.as_of_basis).toBe("report_date");
    // teo <= as_of keeps 2025-09-30 and 2025-12-31.
    expect(body.n_periods).toBe(2);
    expect(body.end_teo).toBe("2025-12-31");
    // No real knowledge-time stamp available for the served window: the
    // filer-level latest_filing_date must NOT be substituted under as_of.
    expect(res.headers.get("X-Data-Filing-Date")).toBeNull();
  });

  it("404s with an as_of-specific message when no rows were known", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(FILER as never);
    vi.mocked(readFilerPortfolioSeries).mockResolvedValue(ROWS);

    const res = await portfolioGET(
      req("/api/13f/filers/BW-FILER-X/portfolio?as_of=2005-01-01"),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/as of the requested date/);
  });
});
