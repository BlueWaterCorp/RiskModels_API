import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));
vi.mock("@/lib/dal/funds-engine", () => ({ fetchFund: vi.fn() }));
vi.mock("@/lib/dal/filers-engine", () => ({ fetchFiler: vi.fn() }));
vi.mock("@/lib/dal/funds-zarr-reader", () => ({ readDailyReturnsCube: vi.fn() }));

import { fetchFund } from "@/lib/dal/funds-engine";
import { fetchFiler } from "@/lib/dal/filers-engine";
import { readDailyReturnsCube } from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as fundGET } from "@/app/api/funds/[bw_fund_id]/attribution-history/route";
import { GET as filerGET } from "@/app/api/13f/filers/[bw_filer_id]/attribution-history/route";

type Handler = (req: NextRequest, ctx: BillingContext) => Promise<NextResponse>;
const ctx = {} as BillingContext;
const req = (path: string) => new NextRequest(new Request(`http://localhost${path}`));

const CUBE = {
  teo: ["2020-01-02", "2020-01-03"],
  gross_return: [0.01, 0.02],
  l1_market: [0.006, 0.01],
  l2_sector: [0.001, 0.002],
  l3_subsector: [0.001, 0.003],
  l3_residual: [0.002, 0.005],
  style_return: null,
  weight_coverage: [0.99, 0.99],
  mapping_coverage: [0.95, 0.95],
  holding_report_date: ["2019-12-31", "2019-12-31"],
};

beforeEach(() => {
  vi.mocked(fetchFund).mockReset();
  vi.mocked(fetchFiler).mockReset();
  vi.mocked(readDailyReturnsCube).mockReset();
});

describe("GET /api/13f/filers/[id]/attribution-history", () => {
  it("serves the actual series with its clock and start rule", async () => {
    vi.mocked(fetchFiler).mockResolvedValue({ cik: "0001067983", name: "BERKSHIRE", latest_filing_date: "2026-11-14" } as never);
    vi.mocked(readDailyReturnsCube).mockResolvedValue(CUBE);
    const res = await (filerGET as unknown as Handler)(req("/api/13f/filers/1067983/attribution-history"), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(readDailyReturnsCube)).toHaveBeenCalledWith("filer", "BW-FILER-CIK0001067983");
    const body = await res.json();
    expect(body.history_kind).toBe("actual");
    expect(body.time_basis).toBe("period_of_report");
    expect(body.frequency).toBe("daily");
    expect(body.first_reliable_date).toBe("2020-01-02");
    expect(body.first_reliable_rule.coverage_enter).toBe(0.5);
    expect(body.series.gross).toEqual([0.01, 0.02]);
    expect(res.headers.get("X-Data-As-Of")).toBe("2020-01-03");
  });

  it("404s an unknown filer before opening the store", async () => {
    vi.mocked(fetchFiler).mockResolvedValue(null);
    const res = await (filerGET as unknown as Handler)(req("/api/13f/filers/1/attribution-history"), ctx);
    expect(res.status).toBe(404);
    expect(vi.mocked(readDailyReturnsCube)).not.toHaveBeenCalled();
  });
});

describe("GET /api/funds/[id]/attribution-history", () => {
  it("400s a malformed window", async () => {
    const res = await (fundGET as unknown as Handler)(
      req("/api/funds/BW-FUND-X/attribution-history?start_date=2020"),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the store is not published", async () => {
    vi.mocked(fetchFund).mockResolvedValue({ ticker: "FCNTX", fund_name: "Contrafund", latest_filing_date: null } as never);
    vi.mocked(readDailyReturnsCube).mockResolvedValue(null);
    const res = await (fundGET as unknown as Handler)(req("/api/funds/BW-FUND-X/attribution-history"), ctx);
    expect(res.status).toBe(404);
  });

  it("serves the fund series from the fund store", async () => {
    vi.mocked(fetchFund).mockResolvedValue({ ticker: "FCNTX", fund_name: "Contrafund", latest_filing_date: null } as never);
    vi.mocked(readDailyReturnsCube).mockResolvedValue({ ...CUBE, style_return: [0, 0], mapping_coverage: null, holding_report_date: null });
    const res = await (fundGET as unknown as Handler)(req("/api/funds/BW-FUND-X/attribution-history"), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(readDailyReturnsCube)).toHaveBeenCalledWith("fund", "BW-FUND-X");
    const body = await res.json();
    expect(body.ticker).toBe("FCNTX");
    expect(body.series.book_report_date).toBeUndefined();
  });
});
