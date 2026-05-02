import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/dal/funds-engine", () => ({
  resolveFundById: vi.fn(),
  resolveFundsByIds: vi.fn(),
  fetchFundLatest: vi.fn(),
  searchFunds: vi.fn(),
  getStyleCellMembers: vi.fn(),
}));

import {
  fetchFundLatest,
  getStyleCellMembers,
  resolveFundById,
  resolveFundsByIds,
  searchFunds,
} from "@/lib/dal/funds-engine";

import { GET as getFund } from "@/app/api/data/funds/[bw_fund_id]/route";
import { GET as getFundLatest } from "@/app/api/data/funds-latest/[bw_fund_id]/route";
import { POST as postFundsBatch } from "@/app/api/data/funds/batch/route";
import { GET as getFundsSearch } from "@/app/api/data/funds/search/route";
import { GET as getStyleMembers } from "@/app/api/data/funds/style/[slug]/members/route";

const FUND = {
  bw_fund_id: "BW-FUND-X",
  series_id: "SX",
  ticker: "VFINX",
  cik: null,
  fund_name: "Test Fund",
  morningstar_category: null,
  equity_style_9box: "Large Blend",
  style_link_method: null,
  primary_bw_fund_id: null,
  latest_report_date: "2026-04-30",
  latest_filing_date: "2026-07-14",
  latest_extracted_at: null,
  latest_total_adj_mv: 1000,
  latest_n_holdings: 10,
  latest_effective_n: 5,
  last_in_eligible_universe_at: null,
  metadata: {},
};

const LATEST = {
  bw_fund_id: "BW-FUND-X",
  report_date: "2026-04-30",
  filing_date: "2026-07-14",
  extracted_at: "2026-05-02T16:38:21.330085+00:00",
  portfolio_gross_return: 0.05,
  portfolio_market_return: 0.04,
  portfolio_sector_return: 0.005,
  portfolio_subsector_return: 0.003,
  portfolio_idiosyncratic_return: 0.002,
  identity_residual: null,
  weight_sum: 1,
  n_holdings_active: 10,
  effective_n: 5,
  top10_weight_sum: 0.5,
  total_adj_mv: 1000,
  equity_style_9box: "Large Blend",
  n_funds_in_cell_at_report_date: 100,
  model_version: "funds_dag.v20260502",
  factor_set_id: "uni_mc_3000_SPY",
  last_synced_at: "2026-05-02T16:41:31.441605+00:00",
  metadata: {},
};

beforeEach(() => {
  vi.mocked(resolveFundById).mockReset();
  vi.mocked(resolveFundsByIds).mockReset();
  vi.mocked(fetchFundLatest).mockReset();
  vi.mocked(searchFunds).mockReset();
  vi.mocked(getStyleCellMembers).mockReset();
});

afterEach(() => {
  delete process.env.RISKMODELS_API_SERVICE_KEY;
});

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

describe("GET /api/data/funds/[bw_fund_id]", () => {
  it("returns 200 with fund + latest and bitemporal headers", async () => {
    vi.mocked(resolveFundById).mockResolvedValue({ fund: FUND, latest: LATEST });
    const res = await getFund(req("http://localhost/api/data/funds/BW-FUND-X"), {
      params: Promise.resolve({ bw_fund_id: "BW-FUND-X" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    expect(res.headers.get("X-Risk-Model-Version")).toBe("funds_dag.v20260502");
    const body = await res.json();
    expect(body.fund.ticker).toBe("VFINX");
    expect(body.latest.portfolio_gross_return).toBeCloseTo(0.05);
  });

  it("returns 404 when DAL returns null", async () => {
    vi.mocked(resolveFundById).mockResolvedValue(null);
    const res = await getFund(req("http://localhost/api/data/funds/BW-FUND-MISSING"), {
      params: Promise.resolve({ bw_fund_id: "BW-FUND-MISSING" }),
    });
    expect(res.status).toBe(404);
  });

  it("omits bitemporal headers when latest is null", async () => {
    vi.mocked(resolveFundById).mockResolvedValue({ fund: FUND, latest: null });
    const res = await getFund(req("http://localhost/api/data/funds/BW-FUND-X"), {
      params: Promise.resolve({ bw_fund_id: "BW-FUND-X" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBeNull();
    expect(res.headers.get("X-Data-Filing-Date")).toBeNull();
  });

  it("rejects an invalid Bearer token (soft auth still validates when service key set)", async () => {
    process.env.RISKMODELS_API_SERVICE_KEY = "secret";
    const res = await getFund(
      req("http://localhost/api/data/funds/BW-FUND-X", {
        headers: { authorization: "Bearer wrong" },
      }),
      { params: Promise.resolve({ bw_fund_id: "BW-FUND-X" }) },
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(resolveFundById)).not.toHaveBeenCalled();
  });
});

describe("GET /api/data/funds/style/[slug]/members", () => {
  it("returns fund_ids for a valid slug", async () => {
    vi.mocked(getStyleCellMembers).mockResolvedValue([
      "BW-FUND-A",
      "BW-FUND-B",
    ]);
    const res = await getStyleMembers(
      req("http://localhost/api/data/funds/style/large-blend/members"),
      { params: Promise.resolve({ slug: "large-blend" }) },
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(getStyleCellMembers)).toHaveBeenCalledWith("Large Blend", {
      primaryOnly: false,
      limit: 5000,
    });
    const body = await res.json();
    expect(body.equity_style_9box).toBe("Large Blend");
    expect(body.fund_ids).toEqual(["BW-FUND-A", "BW-FUND-B"]);
    expect(body.count).toBe(2);
  });

  it("rejects an unknown slug with 400", async () => {
    const res = await getStyleMembers(
      req("http://localhost/api/data/funds/style/mega-blend/members"),
      { params: Promise.resolve({ slug: "mega-blend" }) },
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(getStyleCellMembers)).not.toHaveBeenCalled();
  });

  it("forwards primary=true and clamps limit", async () => {
    vi.mocked(getStyleCellMembers).mockResolvedValue([]);
    await getStyleMembers(
      req(
        "http://localhost/api/data/funds/style/small-value/members?primary=true&limit=999999",
      ),
      { params: Promise.resolve({ slug: "small-value" }) },
    );
    expect(vi.mocked(getStyleCellMembers)).toHaveBeenCalledWith("Small Value", {
      primaryOnly: true,
      limit: 20_000,
    });
  });
});

describe("GET /api/data/funds/search", () => {
  it("forwards q + style slug to DAL (slug → DB name)", async () => {
    vi.mocked(searchFunds).mockResolvedValue([FUND]);
    const res = await getFundsSearch(
      req(
        "http://localhost/api/data/funds/search?q=vfinx&equity_style_9box=large-blend&primary=true&limit=10",
      ),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(searchFunds)).toHaveBeenCalledWith({
      q: "vfinx",
      equityStyle9Box: "Large Blend",
      primaryOnly: true,
      limit: 10,
    });
    const body = await res.json();
    expect(body.results.length).toBe(1);
  });

  it("accepts canonical DB form for equity_style_9box (e.g., 'Large Blend')", async () => {
    vi.mocked(searchFunds).mockResolvedValue([]);
    await getFundsSearch(
      req(
        "http://localhost/api/data/funds/search?equity_style_9box=Large%20Blend",
      ),
    );
    const call = vi.mocked(searchFunds).mock.calls[0][0]!;
    expect(call.equityStyle9Box).toBe("Large Blend");
  });

  it("clamps limit to 500", async () => {
    vi.mocked(searchFunds).mockResolvedValue([]);
    await getFundsSearch(
      req("http://localhost/api/data/funds/search?limit=99999"),
    );
    expect(vi.mocked(searchFunds).mock.calls[0][0]?.limit).toBe(500);
  });

  it("default limit is 50; primary=false unless explicitly true", async () => {
    vi.mocked(searchFunds).mockResolvedValue([]);
    await getFundsSearch(req("http://localhost/api/data/funds/search"));
    const call = vi.mocked(searchFunds).mock.calls[0][0]!;
    expect(call.limit).toBe(50);
    expect(call.primaryOnly).toBe(false);
  });
});

describe("POST /api/data/funds/batch", () => {
  function postReq(body: unknown): NextRequest {
    return req("http://localhost/api/data/funds/batch", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  it("returns results keyed by bw_fund_id", async () => {
    vi.mocked(resolveFundsByIds).mockResolvedValue(
      new Map([["BW-FUND-X", { fund: FUND, latest: LATEST }]]),
    );
    const res = await postFundsBatch(postReq({ fund_ids: ["BW-FUND-X"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results["BW-FUND-X"].fund.ticker).toBe("VFINX");
    expect(body.results["BW-FUND-X"].latest.report_date).toBe("2026-04-30");
  });

  it("rejects empty fund_ids", async () => {
    const res = await postFundsBatch(postReq({ fund_ids: [] }));
    expect(res.status).toBe(400);
    expect(vi.mocked(resolveFundsByIds)).not.toHaveBeenCalled();
  });

  it("rejects more than 1000 ids", async () => {
    const fund_ids = Array.from({ length: 1001 }, (_, i) => `BW-FUND-${i}`);
    const res = await postFundsBatch(postReq({ fund_ids }));
    expect(res.status).toBe(400);
    expect(vi.mocked(resolveFundsByIds)).not.toHaveBeenCalled();
  });

  it("rejects non-string entries", async () => {
    const res = await postFundsBatch(postReq({ fund_ids: ["BW-FUND-X", 42] }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const r = req("http://localhost/api/data/funds/batch", {
      method: "POST",
      body: "{ not json",
      headers: { "content-type": "application/json" },
    });
    const res = await postFundsBatch(r);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/data/funds-latest/[bw_fund_id]", () => {
  it("returns 200 with the latest row and headers", async () => {
    vi.mocked(fetchFundLatest).mockResolvedValue(LATEST);
    const res = await getFundLatest(
      req("http://localhost/api/data/funds-latest/BW-FUND-X"),
      { params: Promise.resolve({ bw_fund_id: "BW-FUND-X" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Data-Filing-Date")).toBe("2026-07-14");
    const body = await res.json();
    expect(body.bw_fund_id).toBe("BW-FUND-X");
  });

  it("returns 404 when DAL returns null", async () => {
    vi.mocked(fetchFundLatest).mockResolvedValue(null);
    const res = await getFundLatest(
      req("http://localhost/api/data/funds-latest/BW-FUND-MISSING"),
      { params: Promise.resolve({ bw_fund_id: "BW-FUND-MISSING" }) },
    );
    expect(res.status).toBe(404);
  });
});
