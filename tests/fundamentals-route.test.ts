import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/fundamentals-zarr-reader", async (importOriginal) => {
  // Keep the real pure exports (accessors, types); mock only the GCS entry points.
  const actual = await importOriginal<typeof import("@/lib/dal/fundamentals-zarr-reader")>();
  return {
    ...actual,
    getFundamentalsForTicker: vi.fn(),
    getFundamentalsSensitivityGrid: vi.fn(),
  };
});

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(),
  fetchLatestMetricsWithFallback: vi.fn(),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn(),
}));

import {
  getFundamentalsForTicker,
  getFundamentalsSensitivityGrid,
} from "@/lib/dal/fundamentals-zarr-reader";
import {
  fetchLatestMetricsWithFallback,
  resolveSymbolByTicker,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  FUNDAMENTALS_HELD_BACK_FIELDS,
  FUNDAMENTALS_ROW_ALLOWED_FIELDS,
} from "@/lib/api/fundamentals-contract";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as wrappedGET } from "@/app/api/fundamentals/[ticker]/route";

const fundamentalsGET = wrappedGET as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "fundamentals",
  costUsd: 0.005,
  startTime: Date.now(),
};

const METADATA = {
  model_version: "v3-test",
  data_as_of: "2026-07-03",
  factor_set_id: "SPY_uni_mc_3000",
  universe_size: 3000,
  wiki_uri: "https://example.test/wiki",
  factors: ["SPY"],
};

function req(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`));
}

const CLEAN_ROW = {
  period_end_date: "2025-09-30",
  filed_date: "2025-10-31",
  filed_date_source: "exact" as const,
  gross_margin: null,
  operating_margin: null,
  roe_ttm: 1.6,
  roa_ttm: 0.33,
  leverage_ratio: 1.27,
  fcf_margin: 0.26,
  payout_ratio: 0.15,
  retention_ratio: 0.85,
  buyback_ratio: 0.8,
  total_payout_ratio: 0.95,
  sustainable_growth: 1.36,
  equity_bridge_residual: null,
  equity_bridge_inputs: [],
  beta_market: 1.2,
  beta_sector: -0.2,
  beta_subsector: -0.1,
  beta_source: "in-universe" as const,
  rf_rate: null,
  cost_of_equity: null,
  cost_of_debt: null,
  wacc: null,
  economic_profit: null,
  sec_facts: {},
};

beforeEach(() => {
  vi.mocked(getFundamentalsForTicker).mockReset();
  vi.mocked(getFundamentalsSensitivityGrid).mockReset();
  vi.mocked(resolveSymbolByTicker).mockReset();
  vi.mocked(fetchLatestMetricsWithFallback).mockReset();
  vi.mocked(getRiskMetadata).mockReset();
  vi.mocked(getRiskMetadata).mockResolvedValue(METADATA as never);
  vi.mocked(resolveSymbolByTicker).mockResolvedValue(null);
});

describe("GET /api/fundamentals/[ticker]", () => {
  it("returns 200 with sanitized rows, disclosures, and parameter echo", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({
      ticker: "AAPL",
      rows: [CLEAN_ROW],
    });

    const res = await fundamentalsGET(
      req("/api/fundamentals/AAPL?as_of=2026-03-31&periods=4&erp=0.06&tax_rate=0.25"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ticker).toBe("AAPL");
    expect(body.as_of).toBe("2026-03-31");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].period_end_date).toBe("2025-09-30");
    expect(body.rows[0].roe_ttm).toBe(1.6);

    // Reader receives the parsed params (PIT + cost-of-capital knobs).
    expect(getFundamentalsForTicker).toHaveBeenCalledWith("AAPL", {
      asOf: "2026-03-31",
      periods: 4,
      erp: 0.06,
      taxRate: 0.25,
      rfTenor: "10y",
    });

    // Disclosures: realized-only statement, coverage note, conditional-beta
    // caveat, and the parameter echo.
    expect(body.disclosures.realized_historical_only).toMatch(/realized historical/i);
    expect(body.disclosures.coverage).toMatch(/2009/);
    expect(body.disclosures.conditional_beta_cost_of_equity).toMatch(/conditional/i);
    expect(body.disclosures.parameters.erp).toBe(0.06);
    expect(body.disclosures.parameters.tax_rate).toBe(0.25);
    expect(body.disclosures.parameters.as_of).toBe("2026-03-31");
  });

  it("ALLOWLIST FAILSAFE: raw vendor fields never appear in a response row, even if the reader leaks them", async () => {
    const leakyRow: Record<string, unknown> = { ...CLEAN_ROW };
    for (const f of FUNDAMENTALS_HELD_BACK_FIELDS) {
      leakyRow[f] = 94_800_000_000; // simulated raw line item leak
    }
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({
      ticker: "AAPL",
      rows: [leakyRow as never],
    });

    const res = await fundamentalsGET(req("/api/fundamentals/AAPL"), fakeContext);
    expect(res.status).toBe(200);
    const body = await res.json();
    const allowed = new Set<string>(FUNDAMENTALS_ROW_ALLOWED_FIELDS);
    for (const row of body.rows) {
      for (const key of Object.keys(row)) {
        expect(allowed.has(key), `non-allowlisted key "${key}" reached the wire`).toBe(true);
      }
      for (const f of FUNDAMENTALS_HELD_BACK_FIELDS) {
        expect(f in row, `held-back field "${f}" reached the wire`).toBe(false);
      }
    }
    // Also assert the raw payload text never contains a held-back key.
    const text = JSON.stringify(body.rows);
    expect(text).not.toContain('"revenue"');
    expect(text).not.toContain('"net_income"');
    expect(text).not.toContain('"eps_actual"');
  });

  it("defaults: as_of=today, periods=8, erp=0.05, tax_rate=0.21", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({ ticker: "AAPL", rows: [] });
    const res = await fundamentalsGET(req("/api/fundamentals/aapl"), fakeContext);
    expect(res.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(getFundamentalsForTicker).toHaveBeenCalledWith("AAPL", {
      asOf: today,
      periods: 8,
      erp: 0.05,
      taxRate: 0.21,
      rfTenor: "10y",
    });
  });

  it("404 when the ticker is not in the fundamentals panel", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue(null);
    const res = await fundamentalsGET(req("/api/fundamentals/NOPE"), fakeContext);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Symbol not found");
  });

  it("400 on out-of-range periods (anti-scrape cap at 40) and malformed params", async () => {
    const tooMany = await fundamentalsGET(
      req("/api/fundamentals/AAPL?periods=200"),
      fakeContext,
    );
    expect(tooMany.status).toBe(400);
    expect(getFundamentalsForTicker).not.toHaveBeenCalled();

    const badDate = await fundamentalsGET(
      req("/api/fundamentals/AAPL?as_of=notadate"),
      fakeContext,
    );
    expect(badDate.status).toBe(400);

    const badTicker = await fundamentalsGET(
      req("/api/fundamentals/WAYTOOLONGTICKER"),
      fakeContext,
    );
    expect(badTicker.status).toBe(400);
  });

  it("market_cap is a best-effort current snapshot and failures never break the response", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({
      ticker: "AAPL",
      rows: [CLEAN_ROW],
    });
    vi.mocked(resolveSymbolByTicker).mockResolvedValue({
      symbol: "BW-FIGI-X",
      ticker: "AAPL",
    } as never);
    vi.mocked(fetchLatestMetricsWithFallback).mockResolvedValue({
      teo: "2026-07-03",
      metrics: { market_cap: 3_500_000_000_000 },
    });

    const ok = await fundamentalsGET(req("/api/fundamentals/AAPL"), fakeContext);
    const okBody = await ok.json();
    expect(okBody.market_cap.value).toBe(3_500_000_000_000);
    expect(okBody.market_cap.basis).toBe("current_snapshot");

    vi.mocked(fetchLatestMetricsWithFallback).mockRejectedValue(new Error("supabase down"));
    const degraded = await fundamentalsGET(req("/api/fundamentals/AAPL"), fakeContext);
    expect(degraded.status).toBe(200);
    const degradedBody = await degraded.json();
    expect(degradedBody.market_cap.value).toBeNull();
  });

  it("sensitivity_grid is omitted by default and included only when grid=true", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({ ticker: "AAPL", rows: [CLEAN_ROW] });

    const withoutGrid = await fundamentalsGET(req("/api/fundamentals/AAPL"), fakeContext);
    const withoutGridBody = await withoutGrid.json();
    expect(withoutGridBody).not.toHaveProperty("sensitivity_grid");
    expect(getFundamentalsSensitivityGrid).not.toHaveBeenCalled();

    vi.mocked(getFundamentalsSensitivityGrid).mockResolvedValue({
      period_end_date: "2025-09-30",
      filed_date: "2025-10-31",
      erp_values: [0.03, 0.04, 0.05, 0.06, 0.07],
      rf_tenor_values: ["3m", "1y", "2y", "5y", "10y", "30y"],
      tax_rate: 0.21,
      cells: [],
    });
    const withGrid = await fundamentalsGET(
      req("/api/fundamentals/AAPL?grid=true&erp_grid=0.04,0.06&rf_tenor_grid=1y,10y"),
      fakeContext,
    );
    expect(withGrid.status).toBe(200);
    const withGridBody = await withGrid.json();
    expect(withGridBody.sensitivity_grid.period_end_date).toBe("2025-09-30");
    expect(getFundamentalsSensitivityGrid).toHaveBeenCalledWith("AAPL", {
      asOf: expect.any(String),
      erpGrid: [0.04, 0.06],
      rfTenorGrid: ["1y", "10y"],
      taxRate: 0.21,
    });
  });

  it("serves JSON only — no CSV/bulk export even when a format param is passed", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({
      ticker: "AAPL",
      rows: [CLEAN_ROW],
    });
    const res = await fundamentalsGET(
      req("/api/fundamentals/AAPL?format=csv"),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    // Billed per-call surface: response must not be publicly cacheable.
    expect(res.headers.get("Cache-Control")).toContain("private");
  });
});
