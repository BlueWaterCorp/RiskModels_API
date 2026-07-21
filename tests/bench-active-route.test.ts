/**
 * /api/data/benchmark-fit — bench-active routing (DAL + billing mocked).
 *
 * The pricing split: static benches (SPY, aliases, bw_bench_id) stay on the
 * free gateway plane (verifyGatewayAuth, computeBenchmarkFit — the billed
 * wrapper is never entered); custom benches (ff_own / cell_<slug> / all) go
 * through the withBilling capability wrapper (bench-active-custom). Bad cell
 * slugs are a 400 on either plane, before auth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ billedCalls: [] as string[] }));

vi.mock("@/lib/agent/billing-middleware", () => ({
  // Stand-in for the withBilling wrapper: records every billed-plane entry
  // (benchmark param) and invokes the inner handler directly.
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) => {
      h.billedCalls.push(new URL(req.url).searchParams.get("benchmark") ?? "");
      return handler(req, { capabilityId: "bench-active-custom" });
    },
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  computeBenchmarkFit: vi.fn(),
  computeBenchActiveFit: vi.fn(),
  computeBenchActiveFitAll: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/data/benchmark-fit/route";
import {
  computeBenchActiveFit,
  computeBenchActiveFitAll,
  computeBenchmarkFit,
} from "@/lib/dal/funds-zarr-reader";

const mockStaticFit = computeBenchmarkFit as unknown as ReturnType<typeof vi.fn>;
const mockCustomFit = computeBenchActiveFit as unknown as ReturnType<typeof vi.fn>;
const mockAllFit = computeBenchActiveFitAll as unknown as ReturnType<typeof vi.fn>;

const req = (u: string) => new NextRequest(u);

const STATIC_FIT = {
  fit_schema_version: "benchmark-fit/1.0",
  subject_id: "BW-FUND-S000004310",
  subject_source_kind: "fund",
  benchmark_context_id: "BW-BENCH-SPY",
  benchmark_name: "S&P 500 (proxy IVV)",
  benchmark_kind: "static",
  subject_teo: "2026-04-30",
  benchmark_teo: "2026-04-30",
  n_subject_holdings: 60,
  n_benchmark_constituents: 494,
  n_overlap: 52,
  active_share: 0.41,
  active_weight_rms: 0.12,
  weight_in_benchmark: 0.93,
  benchmark_coverage: 0.7,
  top_overweights: [],
  top_underweights: [],
};

const FF_OWN_FIT = {
  ...STATIC_FIT,
  fit_schema_version: "benchmark-fit/1.1",
  benchmark_context_id: "ff_own",
  benchmark_name: "Own-holdings free-float cap benchmark",
  benchmark_kind: "ff_own",
  benchmark_teo: "2026-04-29",
  benchmark_provenance: {
    cap_var: "free_float_market_cap",
    cap_coverage: 0.97,
    caps_as_of: "2026-04-29",
    n_cap_dropped: 2,
  },
};

const CELL_FIT = {
  ...STATIC_FIT,
  fit_schema_version: "benchmark-fit/1.1",
  benchmark_context_id: "cell_large-growth",
  benchmark_name: "9-box style cell: Large Growth (MV)",
  benchmark_kind: "cell",
  benchmark_provenance: { cell_slug: "large-growth", cell_teo: "2026-04-30" },
};

beforeEach(() => {
  mockStaticFit.mockReset();
  mockCustomFit.mockReset();
  mockAllFit.mockReset();
  h.billedCalls.length = 0;
});

describe("GET /api/data/benchmark-fit — static bench stays gateway-free", () => {
  it("serves SPY via the gateway path; the billed wrapper is never entered", async () => {
    mockStaticFit.mockResolvedValue(STATIC_FIT);
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-S000004310&benchmark=SPY"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmark_kind).toBe("static");
    expect(mockStaticFit).toHaveBeenCalledWith("BW-FUND-S000004310", "SPY", { asOf: undefined, topN: 10 });
    expect(mockCustomFit).not.toHaveBeenCalled();
    expect(mockAllFit).not.toHaveBeenCalled();
    expect(h.billedCalls).toEqual([]);
  });

  it("404 on an unknown static benchmark (existing semantics)", async () => {
    mockStaticFit.mockResolvedValue(null);
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X&benchmark=NOPE"));
    expect(res.status).toBe(404);
    expect(h.billedCalls).toEqual([]);
  });
});

describe("GET /api/data/benchmark-fit — custom benches go through billing", () => {
  it("ff_own → billed path, provenance + headers surfaced", async () => {
    mockCustomFit.mockResolvedValue(FF_OWN_FIT);
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-S000004310&benchmark=ff_own&top=5"));
    expect(res.status).toBe(200);
    expect(h.billedCalls).toEqual(["ff_own"]);
    expect(mockCustomFit).toHaveBeenCalledWith("BW-FUND-S000004310", "ff_own", { asOf: undefined, topN: 5 });
    expect(mockStaticFit).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.benchmark_kind).toBe("ff_own");
    expect(body.benchmark_provenance.cap_var).toBe("free_float_market_cap");
    expect(body.benchmark_provenance.cap_coverage).toBe(0.97);
    expect(body.benchmark_provenance.n_cap_dropped).toBe(2);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Benchmark-As-Of")).toBe("2026-04-29");
  });

  it("cell_<slug> → billed path with cell provenance", async () => {
    mockCustomFit.mockResolvedValue(CELL_FIT);
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FILER-CIK1&benchmark=cell_large-growth&as_of=2026-03-31"));
    expect(res.status).toBe(200);
    expect(h.billedCalls).toEqual(["cell_large-growth"]);
    expect(mockCustomFit).toHaveBeenCalledWith("BW-FILER-CIK1", "cell_large-growth", { asOf: "2026-03-31", topN: 10 });
    const body = await res.json();
    expect(body.benchmark_kind).toBe("cell");
    expect(body.benchmark_provenance.cell_slug).toBe("large-growth");
  });

  it("all → one billed call, fan-out payload, X-Data-As-Of only", async () => {
    mockAllFit.mockResolvedValue({
      fit_schema_version: "benchmark-fit/1.1",
      subject_id: "BW-FUND-S000004310",
      subject_source_kind: "fund",
      subject_teo: "2026-04-30",
      fits: [STATIC_FIT, FF_OWN_FIT, CELL_FIT],
      omitted: [],
    });
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-S000004310&benchmark=all"));
    expect(res.status).toBe(200);
    expect(h.billedCalls).toEqual(["all"]);
    expect(mockAllFit).toHaveBeenCalledWith("BW-FUND-S000004310", { asOf: undefined, topN: 10 });
    expect(mockStaticFit).not.toHaveBeenCalled();
    expect(mockCustomFit).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.fits).toHaveLength(3);
    expect(body.omitted).toEqual([]);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Benchmark-As-Of")).toBeNull();
  });

  it("404 when the custom bench has no inputs (cap/cell data missing)", async () => {
    mockCustomFit.mockResolvedValue(null);
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X&benchmark=ff_own"));
    expect(res.status).toBe(404);
    mockAllFit.mockResolvedValue(null);
    const res2 = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X&benchmark=all"));
    expect(res2.status).toBe(404);
  });

  it("400 on a bad cell slug — before auth/billing, no DAL call", async () => {
    const res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X&benchmark=cell_notabox"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid style-cell benchmark/);
    expect(h.billedCalls).toEqual([]);
    expect(mockStaticFit).not.toHaveBeenCalled();
    expect(mockCustomFit).not.toHaveBeenCalled();
    expect(mockAllFit).not.toHaveBeenCalled();
  });

  it("400 on missing params / malformed as_of on the custom plane too", async () => {
    let res = await GET(req("http://x/api/data/benchmark-fit?benchmark=ff_own"));
    expect(res.status).toBe(400);
    res = await GET(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X&benchmark=all&as_of=last-week"));
    expect(res.status).toBe(400);
  });
});
