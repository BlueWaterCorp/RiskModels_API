/**
 * Numeric cells are copied from the XBI 2026-08-06 rows pinned in
 * cohort-variance-shares.test.ts. The route dependencies are mocked so this
 * test remains read-only and deterministic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolsByTickers: vi.fn(),
  fetchLatestMetricsWithFallback: vi.fn(),
}));

vi.mock("@/lib/portfolio/portfolio-diversification-etf-returns", () => ({
  fetchEtfCorrelationMatrices: vi.fn(),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn(),
}));

import { NextRequest } from "next/server";
import {
  fetchLatestMetricsWithFallback,
  resolveSymbolsByTickers,
} from "@/lib/dal/risk-engine-v3";
import { fetchEtfCorrelationMatrices } from "@/lib/portfolio/portfolio-diversification-etf-returns";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { GET } from "@/app/api/landing/concentration/route";

const mockResolve = vi.mocked(resolveSymbolsByTickers);
const mockFetch = vi.mocked(fetchLatestMetricsWithFallback);
const mockCorrelations = vi.mocked(fetchEtfCorrelationMatrices);
const mockMetadata = vi.mocked(getRiskMetadata);

const REAL_ROWS = {
  SYM_A: {
    l3_mkt_er: 0.00406,
    l3_sec_er: 0.01648,
    l3_sub_er: 0.11038,
    l3_res_er: 0.86908,
  },
  SYM_B: {
    l3_mkt_er: 0.08137,
    l3_sec_er: 0.12097,
    l3_sub_er: 0.10262,
    l3_res_er: 0.69504,
  },
} as const;

beforeEach(() => {
  mockResolve.mockReset().mockResolvedValue(new Map([
    ["AAPL", { symbol: "SYM_A", ticker: "AAPL", name: "Apple", sector_etf: null, subsector_etf: null }],
    ["MSFT", { symbol: "SYM_B", ticker: "MSFT", name: "Microsoft", sector_etf: null, subsector_etf: null }],
  ]) as never);
  mockFetch.mockReset().mockImplementation(async (symbol) => ({
    teo: "2026-08-06",
    metrics: {
      ...REAL_ROWS[symbol as keyof typeof REAL_ROWS],
      ...(symbol === "SYM_B" ? { l3_res_er: null } : {}),
      l3_mkt_hr: null,
      l3_sec_hr: null,
      l3_sub_hr: null,
      market_cap: null,
      vol_23d: null,
      stock_var: null,
    },
  }) as never);
  mockCorrelations.mockReset().mockResolvedValue({
    sector: { etfs: [], R: [] },
    subsector: { etfs: [], R: [] },
  });
  mockMetadata.mockReset().mockResolvedValue({
    model_version: "v3-test",
    data_as_of: "2026-08-06",
    factor_set_id: "test",
    universe_size: 3000,
    wiki_uri: "https://example.test/wiki",
    factors: [],
  });
});

describe("GET /api/landing/concentration null semantics", () => {
  it("keeps missing chart metrics null and reports partial ER and volatility coverage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/landing/concentration"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.per_ticker.AAPL.total_er).toBeCloseTo(1, 12);
    expect(body.per_ticker.AAPL.sigma).toBeNull();
    expect(body.per_ticker.MSFT.l3_res_er).toBeNull();
    expect(body.per_ticker.MSFT.total_er).toBeNull();
    expect(body.per_ticker.MSFT.data_quality_flags).toContain("er_inputs_incomplete");
    expect(body.portfolios.equal_weight.er_coverage).toBe(0.5);
    expect(body.portfolios.equal_weight.vol_coverage).toBe(0);
    expect(body.portfolios.equal_weight.variance_naive).toBeNull();
    expect(body.portfolios.equal_weight.aggregation).toBe("covered_weights_not_renormalized");
    expect(body.portfolios.equal_weight.data_quality_flags).toContain(
      "portfolio_er_coverage_incomplete",
    );
    expect(body.data_quality_flags).toContain("volatility_unavailable");
  });
});
