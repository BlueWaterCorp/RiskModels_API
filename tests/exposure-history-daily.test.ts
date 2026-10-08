import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPOSURE_PANEL_VARS, type DailyExposureHistory } from "@/lib/dal/zarr-reader";
import { buildDailyNameRows, dailyCoverage, dailyYears } from "@/lib/portfolio/exposure-history";

const DAYS = ["2023-12-28", "2023-12-29", "2024-01-02", "2024-01-03"];
const col = (vals: number[]) => Float32Array.from(vals);
function daily(): DailyExposureHistory {
  const nan = () => col(DAYS.map(() => NaN));
  const base = () => Object.fromEntries(EXPOSURE_PANEL_VARS.map((v) => [v, nan()])) as DailyExposureHistory["bySymbol"] extends Map<string, infer R> ? R : never;
  const nvda = base();
  nvda.l1_mkt_hr = col([NaN, -1.8, -1.7, -1.6]); // no data on the first day
  nvda.lstar_level = col([NaN, 2, 2, 3]);
  return { teos: DAYS, bySymbol: new Map([["S-NVDA", nvda], ["S-EMPTY", base()]]) };
}
const NAMES = [
  { symbol: "S-NVDA", tickers: ["NVDA"], sector_etf: "XLK", subsector_etf: "SMH" },
  { symbol: "S-EMPTY", tickers: ["EMPTY"], sector_etf: "XLF", subsector_etf: null },
];

describe("daily rows", () => {
  it("splits by calendar year and skips days with no data", () => {
    const d = daily();
    expect(dailyYears(d)).toEqual(["2023", "2024"]);
    const y23 = buildDailyNameRows(d, NAMES, "2023");
    expect(y23.map((r) => r.teo)).toEqual(["2023-12-29"]);
    expect(y23[0]).toMatchObject({ ticker: "NVDA", l1_mkt_beta: expect.closeTo(1.8, 5), lstar_level: 2, l3_sub_hr: null });
    expect(buildDailyNameRows(d, NAMES, "2024")).toHaveLength(2);
  });

  it("reports names with no data in range", () => {
    expect(dailyCoverage(daily(), NAMES)).toEqual({ delivered: ["S-NVDA"], noData: ["S-EMPTY"] });
  });
});

// ---- route ---------------------------------------------------------------
const billed: { count: number | null } = { count: null };
const stored = new Map<string, Record<string, string>>();
const panelCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) => {
      const ctx: Record<string, unknown> = { requestId: "r", userId: "u", costUsd: 5 };
      ctx.setBillableItemCount = (n: number) => {
        billed.count = n;
      };
      return handler(req, ctx);
    },
}));
vi.mock("@/lib/dal/risk-metadata", () => ({ getRiskMetadata: async () => ({}) }));
vi.mock("@/lib/dal/response-headers", () => ({ addMetadataHeaders: () => undefined, buildMetadataBody: () => ({}) }));
vi.mock("@/lib/portfolio/signed-exposure-data", () => ({
  resolveAll: vi.fn(async (ts: string[]) => {
    const reg: Record<string, unknown> = {
      NVDA: { symbol: "S-NVDA", ticker: "NVDA", asset_type: "stock", sector_etf: "XLK", subsector_etf: "SMH" },
      SPY: { symbol: "E-SPY", ticker: "SPY", asset_type: "etf", sector_etf: null, subsector_etf: null },
    };
    return new Map(ts.filter((t) => reg[t]).map((t) => [t, reg[t]]));
  }),
}));
vi.mock("@/lib/dal/zarr-reader", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  readDailyExposureHistory: vi.fn(async () => daily()),
  readExposureMonthEndPanel: vi.fn(async (p: Record<string, unknown>) => {
    panelCalls.push(p);
    return {
      teos: ["2023-11-30", "2023-12-29"],
      etfs: ["SPY", "XLK", "SMH"],
      cov: [new Float32Array(9).fill(1e-4), new Float32Array(9).fill(2e-4)],
      attrs: { built_utc: "b" },
      bySymbol: new Map(),
    };
  }),
}));
vi.mock("@/lib/supabase/storage", () => ({
  EXPOSURE_HISTORY_URL_TTL_SECONDS: 3600,
  serveExposureHistorySet: vi.fn(async (k: string, _b: unknown, required: string[]) => {
    const set = stored.get(k);
    return set && required.every((n) => set[n]) ? set : null;
  }),
  writeExposureHistorySet: vi.fn(async (k: string, _b: unknown, files: Array<{ name: string }>) => {
    const urls = Object.fromEntries(files.map((f) => [f.name, `https://s/${k}/${f.name}`]));
    stored.set(k, urls);
    return urls;
  }),
}));

import { POST } from "@/app/api/portfolio/exposure/history/daily/route";

async function call(body: unknown) {
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request("http://t/api/portfolio/exposure/history/daily", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/portfolio/exposure/history/daily", () => {
  beforeEach(() => {
    billed.count = null;
    stored.clear();
    panelCalls.length = 0;
  });

  it("delivers one names file per year plus month-end covariance, billed on names delivered", async () => {
    const { status, body } = await call({ tickers: ["NVDA", "SPY", "NOPE"], start: "2023-12-01" });
    expect(status).toBe(200);
    expect(body.as_of).toMatchObject({ frequency: "daily", covariance_frequency: "month_end", days: 4 });
    expect(body.files.names.parts.map((p: any) => p.year)).toEqual(["2023", "2024"]);
    expect(body.files.cov.url).toMatch(/\/cov$/);
    expect(billed.count).toBe(2); // NVDA + SPY in the covariance
    expect(body.dropped).toEqual([{ ticker: "NOPE", reason: "symbol_not_found" }]);
    // The covariance read starts a month early so the first days have a month-end to use.
    expect(panelCalls[0]!.start).toBe("2023-11-01");
  });

  it("reuses stored files on a repeat request", async () => {
    await call({ tickers: ["NVDA"] });
    const again = await call({ tickers: ["NVDA"] });
    expect(again.body.files.cached).toBe(true);
    expect(again.body.files.names.parts.map((p: any) => p.year)).toEqual(["2023", "2024"]);
  });

  it("does not reuse a stored set that lacks a year now required", async () => {
    await call({ tickers: ["NVDA"] });
    for (const [k, v] of stored) {
      const { names_2024: _drop, ...rest } = v;
      stored.set(k, rest);
    }
    const again = await call({ tickers: ["NVDA"] });
    expect(again.body.files.cached).toBe(false);
    expect(again.body.files.names.parts.map((p: any) => p.year)).toEqual(["2023", "2024"]);
  });
});
