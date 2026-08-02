/**
 * /api/peers — route validation + DAL passthrough (billing + DAL mocked).
 *
 * The route is a thin billed wrapper over fetchPeersByTicker: it validates
 * `ticker` / `limit`, forwards `group_by` only when it names a real grouping
 * field, and passes the DAL's warnings through untouched (render-svc's
 * peer-group artifact relies on those warnings verbatim — G.43).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) =>
      handler(req, { capabilityId: "peers", costUsd: 0.001, requestId: "req_test" }),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn(async () => ({ data_as_of: "2026-07-31" })),
}));

vi.mock("@/lib/dal/response-headers", () => ({
  addMetadataHeaders: vi.fn(),
  buildMetadataBody: vi.fn(() => ({ data_as_of: "2026-07-31" })),
}));

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  fetchPeersByTicker: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/peers/route";
import { fetchPeersByTicker } from "@/lib/dal/risk-engine-v3";

const mockFetch = fetchPeersByTicker as unknown as ReturnType<typeof vi.fn>;

const req = (qs: string) => new NextRequest(`http://localhost/api/peers${qs}`);

const RESULT = {
  target: {
    ticker: "NVDA",
    company_name: "NVIDIA Corp",
    market_cap: 3.2e12,
    sector_etf: "XLK",
    subsector_etf: "SOXX",
    symbol: "BW-BBG-NVDA",
  },
  group_by: "subsector_etf" as const,
  group_etf: "SOXX",
  peers: [
    {
      ticker: "AVGO",
      company_name: "Broadcom",
      market_cap: 1.1e12,
      sector_etf: "XLK",
      subsector_etf: "SOXX",
      symbol: "BW-BBG-AVGO",
    },
  ],
  warnings: ["Only 1 peers in SOXX; broadening to sector_etf=XLK"],
};

describe("GET /api/peers", () => {
  it("400s when ticker is missing", async () => {
    const res = await GET(req(""), {} as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("ticker");
  });

  it("400s on a non-positive limit", async () => {
    const res = await GET(req("?ticker=NVDA&limit=0"), {} as never);
    expect(res.status).toBe(400);
  });

  it("404s when the DAL cannot resolve the ticker", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const res = await GET(req("?ticker=ZZZQ"), {} as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toContain("ZZZQ");
  });

  it("returns the cohort with warnings passed through verbatim", async () => {
    mockFetch.mockResolvedValueOnce(RESULT);
    const res = await GET(req("?ticker=nvda&limit=6"), {} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticker).toBe("NVDA");
    expect(body.group_by).toBe("subsector_etf");
    expect(body.group_etf).toBe("SOXX");
    expect(body.peer_count).toBe(1);
    expect(body.peers[0].ticker).toBe("AVGO");
    // Warnings are the artifact's honesty channel — verbatim, not summarized.
    expect(body.warnings).toEqual(RESULT.warnings);
    expect(mockFetch).toHaveBeenCalledWith({
      ticker: "NVDA",
      groupBy: undefined,
      limit: 6,
    });
  });

  it("forwards group_by only when it names a real grouping field", async () => {
    mockFetch.mockResolvedValueOnce({ ...RESULT, warnings: [] });
    await GET(req("?ticker=NVDA&group_by=sector_etf"), {} as never);
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: "sector_etf" }),
    );

    mockFetch.mockResolvedValueOnce({ ...RESULT, warnings: [] });
    await GET(req("?ticker=NVDA&group_by=nonsense"), {} as never);
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: undefined }),
    );
  });
});
