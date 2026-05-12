/**
 * /api/data/etf/{ticker}/portfolio + /api/data/benchmark/{id}/portfolio — route behavior (DAL mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial mock: keep the real pure helpers (tickerToBwEtfId, resolveBenchmarkId)
// the routes import, replace only the GCS-reading function.
vi.mock("@/lib/dal/funds-zarr-reader", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, readSurfacePortfolioSeries: vi.fn() };
});

import { NextRequest } from "next/server";
import { GET as getEtfPortfolio } from "@/app/api/data/etf/[ticker]/portfolio/route";
import { GET as getBenchmarkPortfolio } from "@/app/api/data/benchmark/[id]/portfolio/route";
import { readSurfacePortfolioSeries } from "@/lib/dal/funds-zarr-reader";

const mockSeries = readSurfacePortfolioSeries as unknown as ReturnType<typeof vi.fn>;
const req = (u: string) => new NextRequest(u);

const SERIES = {
  portfolio_id: "BW-ETF-IWM",
  source_kind: "etf",
  weight_basis: "latest_holdings_constant",
  teo_frequency: "monthly",
  variance_shares: { market: 0.79, sector: 0.04, subsector: 0.03, residual: 0.143 },
  n_rows: 2,
  rows: [
    { teo: "2026-03-31", portfolio_gross_return: 0.01, portfolio_market_return: 0.009, portfolio_sector_return: 0.0005, portfolio_subsector_return: 0.0003, portfolio_idiosyncratic_return: 0.0002, identity_residual: 0, weight_sum: 0.95, n_holdings_active: 1800, effective_n: 250, top10_weight_sum: 0.06 },
    { teo: "2026-04-30", portfolio_gross_return: -0.02, portfolio_market_return: -0.018, portfolio_sector_return: -0.001, portfolio_subsector_return: -0.0005, portfolio_idiosyncratic_return: -0.0005, identity_residual: 0, weight_sum: 0.95, n_holdings_active: 1800, effective_n: 250, top10_weight_sum: 0.06 },
  ],
};

describe("GET /api/data/etf/:ticker/portfolio", () => {
  beforeEach(() => mockSeries.mockReset());

  it("200 + series + weight_basis + variance_shares + header", async () => {
    mockSeries.mockResolvedValue(SERIES);
    const res = await getEtfPortfolio(req("http://x/api/data/etf/IWM/portfolio"), { params: Promise.resolve({ ticker: "IWM" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    const body = await res.json();
    expect(body.ticker).toBe("IWM");
    expect(body.source_kind).toBe("etf");
    expect(body.weight_basis).toBe("latest_holdings_constant");
    expect(body.variance_shares.market).toBe(0.79);
    expect(body.n_rows).toBe(2);
    expect(body.rows[1].portfolio_gross_return).toBe(-0.02);
    expect(mockSeries).toHaveBeenCalledWith("BW-ETF-IWM", { startDate: undefined, endDate: undefined });
  });

  it("passes start_date/end_date through; 400 on a bad date", async () => {
    mockSeries.mockResolvedValue(SERIES);
    await getEtfPortfolio(req("http://x/api/data/etf/IWM/portfolio?start_date=2025-01-01&end_date=2026-04-30"), { params: Promise.resolve({ ticker: "IWM" }) });
    expect(mockSeries).toHaveBeenLastCalledWith("BW-ETF-IWM", { startDate: "2025-01-01", endDate: "2026-04-30" });
    const res = await getEtfPortfolio(req("http://x/api/data/etf/IWM/portfolio?start_date=jan"), { params: Promise.resolve({ ticker: "IWM" }) });
    expect(res.status).toBe(400);
  });

  it("404 when the ETF has no portfolio decomposition", async () => {
    mockSeries.mockResolvedValue(null);
    const res = await getEtfPortfolio(req("http://x/api/data/etf/ZZZ/portfolio"), { params: Promise.resolve({ ticker: "ZZZ" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/data/benchmark/:id/portfolio", () => {
  beforeEach(() => mockSeries.mockReset());

  it("200 + series on a hit (alias accepted)", async () => {
    mockSeries.mockResolvedValue({ ...SERIES, portfolio_id: "BW-BENCH-SPY", source_kind: "benchmark" });
    const res = await getBenchmarkPortfolio(req("http://x/api/data/benchmark/SPY/portfolio"), { params: Promise.resolve({ id: "SPY" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmark_context_id).toBe("BW-BENCH-SPY");
    expect(body.source_kind).toBe("benchmark");
    expect(mockSeries).toHaveBeenCalledWith("BW-BENCH-SPY", { startDate: undefined, endDate: undefined });
  });

  it("404 when the benchmark id/alias is unknown", async () => {
    const res = await getBenchmarkPortfolio(req("http://x/api/data/benchmark/NOPE/portfolio"), { params: Promise.resolve({ id: "NOPE" }) });
    expect(res.status).toBe(404);
    expect(mockSeries).not.toHaveBeenCalled();
  });

  it("404 when the benchmark resolves but has no decomposition", async () => {
    mockSeries.mockResolvedValue(null);
    const res = await getBenchmarkPortfolio(req("http://x/api/data/benchmark/BW-BENCH-SPY/portfolio"), { params: Promise.resolve({ id: "BW-BENCH-SPY" }) });
    expect(res.status).toBe(404);
  });
});
