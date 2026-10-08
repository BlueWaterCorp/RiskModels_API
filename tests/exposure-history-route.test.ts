import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPOSURE_PANEL_VARS } from "@/lib/dal/zarr-reader";

const billed: { count: number | null } = { count: null };
const stored = new Map<string, Buffer>();

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) => {
      const ctx: Record<string, unknown> = { requestId: "req-1", userId: "u1", costUsd: 5 };
      ctx.setBillableItemCount = (n: number) => {
        billed.count = n;
        ctx.costUsd = n > 25 ? 5 : 1.25;
      };
      return handler(req, ctx);
    },
}));
vi.mock("@/lib/dal/risk-metadata", () => ({ getRiskMetadata: async () => ({}) }));
vi.mock("@/lib/dal/response-headers", () => ({ addMetadataHeaders: () => undefined, buildMetadataBody: () => ({}) }));

const registry: Record<string, Record<string, unknown>> = {
  NVDA: { symbol: "S-NVDA", ticker: "NVDA", asset_type: "stock", sector_etf: "XLK", subsector_etf: "SMH" },
  NEWCO: { symbol: "S-NEW", ticker: "NEWCO", asset_type: "stock", sector_etf: "XLK", subsector_etf: null },
  SPY: { symbol: "E-SPY", ticker: "SPY", asset_type: "etf", sector_etf: null, subsector_etf: null },
};
vi.mock("@/lib/portfolio/signed-exposure-data", () => ({
  resolveAll: vi.fn(async (ts: string[]) => new Map(ts.filter((t) => registry[t]).map((t) => [t, registry[t]]))),
}));

const empty = () => Object.fromEntries(EXPOSURE_PANEL_VARS.map((v) => [v, [null, null]]));
vi.mock("@/lib/dal/zarr-reader", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readExposureMonthEndPanel: vi.fn(async () => ({
      teos: ["2026-08-31", "2026-09-30"],
      etfs: ["SPY", "XLK", "SMH"],
      cov: [new Float32Array(9).fill(1e-4), new Float32Array(9).fill(2e-4)],
      attrs: { built_utc: "2026-10-08T00:00:00Z", source_last_teo: "2026-10-07" },
      bySymbol: new Map<string, Record<string, Array<number | null>>>([
        ["S-NVDA", { ...empty(), l1_mkt_hr: [-1.8, -1.7], stock_var: [9e-4, 8e-4] }],
        ["S-NEW", empty()],
      ]),
    })),
  };
});
vi.mock("@/lib/supabase/storage", () => ({
  signExposureHistoryFile: vi.fn(async (key: string, name: string) =>
    stored.has(`${key}/${name}`) ? `https://signed/${key}/${name}` : null,
  ),
  uploadExposureHistoryFile: vi.fn(async (key: string, name: string, buf: Buffer) => {
    stored.set(`${key}/${name}`, buf);
    return `https://signed/${key}/${name}`;
  }),
}));

import { POST } from "@/app/api/portfolio/exposure/history/route";
import { uploadExposureHistoryFile } from "@/lib/supabase/storage";

async function call(body: unknown) {
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request("http://test/api/portfolio/exposure/history", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/portfolio/exposure/history", () => {
  beforeEach(() => {
    billed.count = null;
    stored.clear();
    vi.mocked(uploadExposureHistoryFile).mockClear();
  });

  it("delivers signed Parquet URLs, bills names delivered, and lists drops", async () => {
    const { status, body } = await call({ tickers: ["NVDA", "NEWCO", "NOPE", "SPY"] });
    expect(status).toBe(200);
    expect(body.files.names.url).toMatch(/^https:\/\/signed\/.+\/names$/);
    expect(body.files.cov.url).toMatch(/\/cov$/);
    expect(body.files.names.rows).toBe(2);
    expect(body.files.cached).toBe(false);
    expect(body.etfs_in_covariance).toEqual(["SPY", "XLK", "SMH"]);
    // NVDA delivered + SPY in the covariance = 2 billable names.
    expect(billed.count).toBe(2);
    expect(body._agent.cost_usd).toBe(1.25);
    expect(Object.fromEntries(body.dropped.map((d: any) => [d.ticker, d.reason]))).toEqual({
      NOPE: "symbol_not_found",
      NEWCO: "no_data_in_range",
    });
  });

  it("reuses the stored files for the same request on the same panel build", async () => {
    await call({ tickers: ["NVDA"] });
    const again = await call({ tickers: ["nvda"] });
    expect(again.body.files.cached).toBe(true);
    expect(vi.mocked(uploadExposureHistoryFile)).toHaveBeenCalledTimes(2); // names + cov, once
  });

  it("returns 422 (not billed) when nothing has history", async () => {
    const { status, body } = await call({ tickers: ["NEWCO", "NOPE"] });
    expect(status).toBe(422);
    expect(billed.count).toBeNull();
    expect(body.dropped).toHaveLength(2);
  });

  it("rejects an empty or oversized ticker list", async () => {
    expect((await call({ tickers: [] })).status).toBe(400);
    expect((await call({ tickers: Array.from({ length: 1001 }, (_, i) => `T${i}`) })).status).toBe(400);
  });
});
