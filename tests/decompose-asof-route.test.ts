/**
 * POST /api/decompose — historical as_of routing (G.42, DAL + billing mocked).
 *
 * The code-path split under test (dispatch Verify case c is the point):
 * no as_of → `fetchLatestMetricsWithFallback` (security_history_latest fast
 * path) and the zarr-bounded `fetchLatestMetrics` is never entered; as_of →
 * `fetchLatestMetrics(symbol, keys, "daily", as_of)` and the fast path is
 * never entered. Historical responses echo `as_of` / `as_of_resolved` /
 * `as_of_basis: "report_date"` (ADR 2026-08-01) plus the non-PIT hedge-label
 * disclosure; nothing at or before as_of is an as_of-specific 404, never the
 * latest row (house PIT convention, AGENTS_CROSS_REPO.md §0).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(),
  fetchLatestMetrics: vi.fn(),
  fetchLatestMetricsWithFallback: vi.fn(),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn(),
}));

import { NextRequest, type NextResponse } from "next/server";
import {
  fetchLatestMetrics,
  fetchLatestMetricsWithFallback,
  resolveSymbolByTicker,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { POST as wrappedPOST } from "@/app/api/decompose/route";

const decomposePOST = wrappedPOST as unknown as (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const mockResolve = resolveSymbolByTicker as unknown as ReturnType<typeof vi.fn>;
const mockAsOfFetch = fetchLatestMetrics as unknown as ReturnType<typeof vi.fn>;
const mockFastPath = fetchLatestMetricsWithFallback as unknown as ReturnType<
  typeof vi.fn
>;
const mockMetadata = getRiskMetadata as unknown as ReturnType<typeof vi.fn>;

const fakeContext = { capabilityId: "decompose-position" } as BillingContext;

const METADATA = {
  model_version: "v3-test",
  data_as_of: "2026-07-31",
  factor_set_id: "SPY_uni_mc_3000",
  universe_size: 3000,
  wiki_uri: "https://example.test/wiki",
  factors: ["SPY"],
};

const SYMBOL = {
  symbol: "SYM_NVDA",
  ticker: "NVDA",
  name: "NVIDIA",
  asset_type: "equity",
  sector_etf: "XLK",
  subsector_etf: "SMH",
  is_adr: false,
  is_modelled_class: true,
  modelled_ticker: null,
  share_class: null,
  modelled_share_class: null,
};

// Latest row vs historical row carry deliberately different ERs so a test
// can assert the served numbers moved with the date (Verify case a shape).
const LATEST_ROW = {
  teo: "2026-07-31",
  metrics: {
    l3_mkt_hr: 1.02,
    l3_sec_hr: 0.31,
    l3_sub_hr: 0.22,
    l3_mkt_er: 0.34,
    l3_sec_er: 0.12,
    l3_sub_er: 0.08,
    l3_res_er: 0.46,
    style_er: 0.05,
    stock_specific_er: 0.41,
  },
};

const HIST_ROW = {
  teo: "2025-06-27",
  metrics: {
    l3_mkt_hr: 0.88,
    l3_sec_hr: 0.4,
    l3_sub_hr: 0.15,
    l3_mkt_er: 0.5,
    l3_sec_er: 0.1,
    l3_sub_er: 0.05,
    l3_res_er: 0.35,
    style_er: 0.03,
    stock_specific_er: 0.3,
  },
};

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/decompose", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockResolve.mockReset().mockResolvedValue(SYMBOL);
  mockAsOfFetch.mockReset();
  mockFastPath.mockReset();
  mockMetadata.mockReset().mockResolvedValue(METADATA);
});

describe("POST /api/decompose — no as_of stays on the fast path (Verify c)", () => {
  it("calls fetchLatestMetricsWithFallback; the as_of read is never entered", async () => {
    mockFastPath.mockResolvedValue(LATEST_ROW);
    const res = await decomposePOST(post({ ticker: "NVDA" }), fakeContext);
    expect(res.status).toBe(200);
    expect(mockFastPath).toHaveBeenCalledTimes(1);
    expect(mockFastPath).toHaveBeenCalledWith(
      "SYM_NVDA",
      expect.arrayContaining(["l3_mkt_er", "l3_res_er", "stock_specific_er"]),
      "daily",
    );
    expect(mockAsOfFetch).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.teo).toBe("2026-07-31");
    expect(body.exposure.market.er).toBeCloseTo(0.34, 6);
    // No historical echo on the default path.
    expect(body.as_of).toBeUndefined();
    expect(body.as_of_resolved).toBeUndefined();
    expect(body.as_of_basis).toBeUndefined();
    expect(body._metadata.data_warning).toBeUndefined();
  });
});

describe("POST /api/decompose — as_of threads to the zarr read (Verify a shape)", () => {
  it("skips the fast path, serves the row ≤ as_of, echoes the basis", async () => {
    mockAsOfFetch.mockResolvedValue(HIST_ROW);
    const res = await decomposePOST(
      post({ ticker: "NVDA", as_of: "2025-06-30" }),
      fakeContext,
    );
    expect(res.status).toBe(200);
    expect(mockAsOfFetch).toHaveBeenCalledTimes(1);
    expect(mockAsOfFetch).toHaveBeenCalledWith(
      "SYM_NVDA",
      expect.arrayContaining(["l3_mkt_er", "l3_res_er", "stock_specific_er"]),
      "daily",
      "2025-06-30",
    );
    expect(mockFastPath).not.toHaveBeenCalled();

    const body = await res.json();
    // Served row's teo is the effective as-of, ≤ the requested date.
    expect(body.teo).toBe("2025-06-27");
    expect(body.as_of).toBe("2025-06-30");
    expect(body.as_of_resolved).toBe("2025-06-27");
    expect(body.as_of_basis).toBe("report_date");
    // Numbers come from the historical row, not the latest one.
    expect(body.exposure.market.er).toBeCloseTo(0.5, 6);
    expect(body.exposure.residual.er).toBeCloseTo(0.35, 6);
    // Disclosed, not fixed: hedge-ETF labels are not point-in-time.
    expect(body._metadata.data_warning).toMatch(/not point-in-time/);
    // Labels still present (from the current registry).
    expect(body.exposure.sector.hedge_etf).toBe("XLK");
  });

  it("404s with an as_of-specific error when nothing is known ≤ as_of (Verify b shape)", async () => {
    mockAsOfFetch.mockResolvedValue(null);
    const res = await decomposePOST(
      post({ ticker: "NVDA", as_of: "1999-01-04" }),
      fakeContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("as_of=1999-01-04");
    expect(body.as_of_basis).toBe("report_date");
    expect(mockFastPath).not.toHaveBeenCalled();
  });

  it("500s if the DAL ever returns a row after as_of (PIT invariant)", async () => {
    mockAsOfFetch.mockResolvedValue({ ...HIST_ROW, teo: "2025-07-02" });
    const res = await decomposePOST(
      post({ ticker: "NVDA", as_of: "2025-06-30" }),
      fakeContext,
    );
    expect(res.status).toBe(500);
  });

  it("400s on malformed as_of before any DAL call", async () => {
    const res = await decomposePOST(
      post({ ticker: "NVDA", as_of: "last-week" }),
      fakeContext,
    );
    expect(res.status).toBe(400);
    expect(mockAsOfFetch).not.toHaveBeenCalled();
    expect(mockFastPath).not.toHaveBeenCalled();
  });
});

describe("POST /api/landing/decompose — preview refuses as_of, never serves latest silently", () => {
  it("400s with a pointer to the full endpoint; no DAL call", async () => {
    const { POST: landingPOST } = await import(
      "@/app/api/landing/decompose/route"
    );
    const res = await landingPOST(
      post({ ticker: "NVDA", as_of: "2025-06-30" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/as_of not supported/);
    expect(mockFastPath).not.toHaveBeenCalled();
    expect(mockAsOfFetch).not.toHaveBeenCalled();
  });
});
