import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Evaluation report 2026-10-08: ETFs came back `success` with null metrics and
 * failed lookups were billed. Copied mock harness from the C.13 test: `batch/analyze` used to carry its own `TICKER_NORMALIZATIONS` map with
 * `GOOG → GOOGL` — the opposite direction from the symbols endpoints. The map
 * is gone; resolution flows through `resolveSymbolByTicker` (which routes
 * through the `resolveTicker` seam), and the response now carries the same
 * share-class disclosure fields as `/api/data/symbols/:ticker`.
 *
 * The DAL is mocked here (the seam agreement itself is pinned in
 * `risk-engine-share-class-resolution.test.ts`); this file asserts the route
 * propagates the DAL's resolution instead of second-guessing it.
 */

const billed: { count: number | null } = { count: null };

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) => {
      const ctx: Record<string, unknown> = { requestId: "test-req", userId: "u1", costUsd: 0.06 };
      ctx.setBillableItemCount = (n: number) => {
        billed.count = n;
        ctx.costUsd = n === 0 ? 0 : 0.03;
      };
      return handler(req, ctx);
    },
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
  const row = (symbol: string, ticker: string, asset_type: string) => ({
    symbol,
    ticker,
    name: null,
    asset_type,
    sector_etf: "XLK",
    subsector_etf: null,
    is_adr: null,
    is_modelled_class: true,
    modelled_ticker: null,
    share_class: null,
    modelled_share_class: null,
  });
  const rows: Record<string, ReturnType<typeof row>> = {
    AAPL: row("BW-AAPL", "AAPL", "stock"),
    XLK: row("BW-XLK", "XLK", "etf"),
  };
  return {
    resolveSymbolByTicker: vi.fn(async (t: string) => rows[t.toUpperCase()] ?? null),
    fetchHistory: vi.fn(async () => []),
    pivotHistory: vi.fn(() => []),
    fetchLatestMetricsWithFallback: vi.fn(async (symbol: string) =>
      symbol === "BW-AAPL"
        ? { teo: "2026-10-07", metrics: { stock_var: 0.0004, l1_mkt_hr: -1.1, l3_mkt_er: 0.4, l3_res_er: 0.5 } }
        : // ETFs resolve but carry no decomposition: every metric null.
          { teo: "2026-10-07", metrics: { stock_var: null, l1_mkt_hr: null, l3_mkt_er: null, l3_res_er: null } },
    ),
  };
});

import { POST } from "@/app/api/batch/analyze/route";

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

describe("POST /api/batch/analyze — ETFs and failed lookups", () => {
  it("reports an ETF with no decomposition as an error, not a success full of nulls", async () => {
    const { status, body } = await callBatch(["AAPL", "XLK", "NOPE"]);
    expect(status).toBe(200);
    expect(body.results.AAPL.status).toBe("success");
    expect(body.results.XLK.status).toBe("error");
    expect(body.results.XLK.error_code).toBe("no_risk_metrics");
    expect(body.results.XLK.error).toMatch(/ETF/);
    expect(body.results.NOPE.error_code).toBe("symbol_not_found");
    expect(body.summary.errors).toBe(2);
  });

  it("bills only the tickers that returned data", async () => {
    billed.count = null;
    const { body } = await callBatch(["AAPL", "XLK", "NOPE"]);
    expect(billed.count).toBe(1);
    expect(body._agent.cost_usd).toBe(0.03);
  });

  it("bills nothing when every ticker fails", async () => {
    billed.count = null;
    const { body } = await callBatch(["XLK", "NOPE"]);
    expect(billed.count).toBe(0);
    expect(body._agent.cost_usd).toBe(0);
  });
});
