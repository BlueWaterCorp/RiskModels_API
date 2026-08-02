import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C.13: `batch/analyze` used to carry its own `TICKER_NORMALIZATIONS` map with
 * `GOOG → GOOGL` — the opposite direction from the symbols endpoints. The map
 * is gone; resolution flows through `resolveSymbolByTicker` (which routes
 * through the `resolveTicker` seam), and the response now carries the same
 * share-class disclosure fields as `/api/data/symbols/:ticker`.
 *
 * The DAL is mocked here (the seam agreement itself is pinned in
 * `risk-engine-share-class-resolution.test.ts`); this file asserts the route
 * propagates the DAL's resolution instead of second-guessing it.
 */

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) =>
      handler(req, { requestId: "test-req", userId: "u1", costUsd: 0 }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: async () => ({ count: 4, error: null }),
    }),
  }),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: async () => ({}),
}));

vi.mock("@/lib/dal/response-headers", () => ({
  addMetadataHeaders: () => undefined,
  buildMetadataBody: () => ({}),
}));

vi.mock("@/lib/api/webhooks", () => ({
  dispatchWebhookEvent: async () => undefined,
}));

vi.mock("@/lib/dal/risk-engine-v3", () => {
  const rows: Record<string, Record<string, unknown>> = {
    GOOG: {
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOG",
      name: null,
      asset_type: "stock",
      sector_etf: "XLC",
      subsector_etf: null,
      is_adr: null,
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    },
    // What the seam-routed DAL returns for a GOOGL request: GOOG's row,
    // relabelled with the requested ticker, substitution carried alongside.
    GOOGL: {
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOGL",
      name: null,
      asset_type: "stock",
      sector_etf: "XLC",
      subsector_etf: null,
      is_adr: null,
      is_modelled_class: false,
      modelled_ticker: "GOOG",
      share_class: "A",
      modelled_share_class: "C",
    },
    // Notation: BRK.B request answered by the BRK-B row itself, silent.
    "BRK-B": {
      symbol: "BW-BBG000DWG505",
      ticker: "BRK-B",
      name: null,
      asset_type: "stock",
      sector_etf: "XLF",
      subsector_etf: null,
      is_adr: null,
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    },
    AAPL: {
      symbol: "BW-BBG000B9XRY4",
      ticker: "AAPL",
      name: null,
      asset_type: "stock",
      sector_etf: "XLK",
      subsector_etf: null,
      is_adr: null,
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    },
  };
  return {
    resolveSymbolByTicker: vi.fn(async (t: string) => {
      const u = t.toUpperCase();
      if (rows[u]) return rows[u];
      // The seam resolves BRK.B → BRK-B inside the DAL (notation, silent).
      if (u === "BRK.B") return rows["BRK-B"];
      return null;
    }),
    fetchHistory: vi.fn(async () => []),
    pivotHistory: vi.fn(() => []),
    fetchLatestMetricsWithFallback: vi.fn(async (symbol: string) => ({
      teo: "2026-07-31",
      metrics: {
        vol_23d: symbol === "BW-BBG009S3NB30" ? 0.43 : 0.2,
        l3_mkt_hr: symbol === "BW-BBG009S3NB30" ? -0.93 : 0.1,
      },
    })),
  };
});

import { POST } from "@/app/api/batch/analyze/route";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";

async function callBatch(tickers: string[]) {
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request("http://test/api/batch/analyze", {
      method: "POST",
      body: JSON.stringify({ tickers, metrics: ["full_metrics"] }),
      headers: { "content-type": "application/json" },
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/batch/analyze — share-class handling (C.13)", () => {
  beforeEach(() => {
    vi.mocked(resolveSymbolByTicker).mockClear();
  });

  it("GOOG is analyzed as GOOG — the old GOOG → GOOGL normalization is gone", async () => {
    const { status, body } = await callBatch(["GOOG"]);
    expect(status).toBe(200);
    const r = body.results.GOOG;
    expect(r.status).toBe("success");
    expect(r.is_modelled_class).toBe(true);
    expect(r.modelled_ticker).toBeNull();
    // The route must never have asked the DAL for GOOGL.
    const asked = vi
      .mocked(resolveSymbolByTicker)
      .mock.calls.map((c) => String(c[0]).toUpperCase());
    expect(asked).toContain("GOOG");
    expect(asked).not.toContain("GOOGL");
  });

  it("GOOGL discloses the projection onto GOOG (same fields as /api/data/symbols)", async () => {
    const { body } = await callBatch(["GOOGL"]);
    const r = body.results.GOOGL;
    expect(r.status).toBe("success");
    expect(r).toMatchObject({
      requested_ticker: "GOOGL",
      is_modelled_class: false,
      modelled_ticker: "GOOG",
      share_class: "A",
      modelled_share_class: "C",
    });
  });

  it("BRK.B stays silent — notation is not a projection", async () => {
    const { body } = await callBatch(["BRK.B"]);
    const r = body.results["BRK.B"];
    expect(r.status).toBe("success");
    expect(r).toMatchObject({
      requested_ticker: "BRK.B",
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    });
  });

  it("ordinary tickers carry the disclosure fields with quiet values", async () => {
    const { body } = await callBatch(["AAPL"]);
    expect(body.results.AAPL).toMatchObject({
      requested_ticker: "AAPL",
      is_modelled_class: true,
      modelled_ticker: null,
    });
  });
});
