/**
 * /api/data/etf/{ticker}/holdings — route behavior (DAL mocked).
 *
 * The DAL (lib/dal/funds-zarr-reader.readEtfHoldingsTopN) is exercised against
 * real GCS in integration; here we mock it to assert the route's contract:
 * 404 on unknown/empty ETF, 200 + canonical-surface JSON + headers on hit,
 * and `top` clamping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readEtfHoldingsTopN: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/data/etf/[ticker]/holdings/route";
import { readEtfHoldingsTopN } from "@/lib/dal/funds-zarr-reader";

const mockRead = readEtfHoldingsTopN as unknown as ReturnType<typeof vi.fn>;

function req(url: string) {
  return new NextRequest(url);
}

const SNAPSHOT = {
  portfolio_id: "BW-ETF-IVV",
  ticker: "IVV",
  source_kind: "etf" as const,
  teo_frequency: "daily" as const,
  sponsor: "ishares",
  report_date: "2025-01-10",
  availability_date: "2025-01-13",
  aum_reported: 998_000_000,
  aum_erm3: 998_000_000,
  coverage_pct: 1.0,
  n_holdings_returned: 5,
  n_total_holdings: 7,
  holdings: [
    { bw_sym_id: "BW-US5949181045", adj_mv: 250_000_000, weight: 0.2505 },
    { bw_sym_id: "BW-US0378331005", adj_mv: 220_000_000, weight: 0.2204 },
  ],
};

describe("GET /api/data/etf/:ticker/holdings", () => {
  beforeEach(() => mockRead.mockReset());

  it("returns 200 with the canonical surface snapshot + bitemporal headers", async () => {
    mockRead.mockResolvedValue(SNAPSHOT);
    const res = await GET(req("http://x/api/data/etf/IVV/holdings?top=5"), {
      params: Promise.resolve({ ticker: "IVV" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2025-01-10");
    expect(res.headers.get("X-Data-Availability")).toBe("2025-01-13");
    const body = await res.json();
    expect(body.source_kind).toBe("etf");
    expect(body.teo_frequency).toBe("daily");
    expect(body.report_date).toBe("2025-01-10");
    expect(body.availability_date).toBe("2025-01-13");
    expect(body.holdings[0].bw_sym_id).toBe("BW-US5949181045");
    expect(mockRead).toHaveBeenCalledWith("IVV", 5);
  });

  it("clamps `top` to [1, 1000] and defaults to 25", async () => {
    mockRead.mockResolvedValue(SNAPSHOT);
    await GET(req("http://x/api/data/etf/IVV/holdings"), { params: Promise.resolve({ ticker: "IVV" }) });
    expect(mockRead).toHaveBeenLastCalledWith("IVV", 25);
    await GET(req("http://x/api/data/etf/IVV/holdings?top=99999"), { params: Promise.resolve({ ticker: "IVV" }) });
    expect(mockRead).toHaveBeenLastCalledWith("IVV", 1000);
    await GET(req("http://x/api/data/etf/IVV/holdings?top=0"), { params: Promise.resolve({ ticker: "IVV" }) });
    expect(mockRead).toHaveBeenLastCalledWith("IVV", 1);
  });

  it("returns 404 when the ETF has no surface zarr / no holdings", async () => {
    mockRead.mockResolvedValue(null);
    const res = await GET(req("http://x/api/data/etf/ZZZZ/holdings"), {
      params: Promise.resolve({ ticker: "ZZZZ" }),
    });
    expect(res.status).toBe(404);
  });
});
