/**
 * /api/data/benchmark/{id} + /api/data/benchmark-fit — route behavior (DAL mocked).
 *
 * The DAL (lib/dal/funds-zarr-reader) is exercised against real GCS in
 * integration; here we mock it to assert the routes' contract: 404 on unknown
 * benchmark / missing surface, 200 + canonical-surface JSON + headers on hit,
 * `top` / `as_of` handling, and the 400s on missing query params.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  readBenchmarkSurface: vi.fn(),
  computeBenchmarkFit: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET as getBenchmark } from "@/app/api/data/benchmark/[id]/route";
import { GET as getBenchmarkFit } from "@/app/api/data/benchmark-fit/route";
import { readBenchmarkSurface, computeBenchmarkFit } from "@/lib/dal/funds-zarr-reader";

const mockBench = readBenchmarkSurface as unknown as ReturnType<typeof vi.fn>;
const mockFit = computeBenchmarkFit as unknown as ReturnType<typeof vi.fn>;
const req = (u: string) => new NextRequest(u);

const SNAP = {
  benchmark_context_id: "BW-BENCH-SPY",
  name: "S&P 500 (proxy IVV)",
  benchmark_kind: "index_proxy",
  source_kind: "benchmark" as const,
  teo_frequency: "daily",
  report_date: "2026-05-11",
  availability_date: "2026-05-12",
  benchmark_context: { bw_bench_id: "BW-BENCH-SPY", benchmark_kind: "index_proxy", proxy: { source_kind: "etf", ref: "IVV" }, aliases: ["SPY"] },
  n_constituents: 494,
  top_constituents: [{ bw_sym_id: "BW-BBG000BBJQV0", weight: 0.087 }, { bw_sym_id: "BW-BBG000B9XRY4", weight: 0.07 }],
};

const FIT = {
  fit_schema_version: "benchmark-fit/1.0",
  subject_id: "BW-FUND-S000004310",
  subject_source_kind: "fund",
  benchmark_context_id: "BW-BENCH-SPY",
  benchmark_name: "S&P 500 (proxy IVV)",
  subject_teo: "2026-04-30",
  benchmark_teo: "2026-04-30",
  n_subject_holdings: 60,
  n_benchmark_constituents: 494,
  n_overlap: 52,
  active_share: 0.41,
  active_weight_rms: 0.12,
  weight_in_benchmark: 0.93,
  benchmark_coverage: 0.7,
  top_overweights: [{ bw_sym_id: "BW-X", subject_weight: 0.05, benchmark_weight: 0.01, active_weight: 0.04 }],
  top_underweights: [{ bw_sym_id: "BW-Y", subject_weight: 0.0, benchmark_weight: 0.03, active_weight: -0.03 }],
};

describe("GET /api/data/benchmark/:id", () => {
  beforeEach(() => mockBench.mockReset());

  it("200 + context + constituents + headers on hit (alias accepted)", async () => {
    mockBench.mockResolvedValue(SNAP);
    const res = await getBenchmark(req("http://x/api/data/benchmark/SPY?top=2"), { params: Promise.resolve({ id: "SPY" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-05-11");
    expect(res.headers.get("X-Data-Availability")).toBe("2026-05-12");
    const body = await res.json();
    expect(body.benchmark_context_id).toBe("BW-BENCH-SPY");
    expect(body.source_kind).toBe("benchmark");
    expect(body.benchmark_kind).toBe("index_proxy");
    expect(body.benchmark_context.proxy.ref).toBe("IVV");
    expect(body.top_constituents[0].bw_sym_id).toBe("BW-BBG000BBJQV0");
    expect(mockBench).toHaveBeenCalledWith("SPY", 2);
  });

  it("clamps `top` and defaults to 25", async () => {
    mockBench.mockResolvedValue(SNAP);
    await getBenchmark(req("http://x/api/data/benchmark/BW-BENCH-SPY"), { params: Promise.resolve({ id: "BW-BENCH-SPY" }) });
    expect(mockBench).toHaveBeenLastCalledWith("BW-BENCH-SPY", 25);
    await getBenchmark(req("http://x/api/data/benchmark/SPY?top=99999"), { params: Promise.resolve({ id: "SPY" }) });
    expect(mockBench).toHaveBeenLastCalledWith("SPY", 1000);
  });

  it("404 when the benchmark is unknown / has no surface", async () => {
    mockBench.mockResolvedValue(null);
    const res = await getBenchmark(req("http://x/api/data/benchmark/NOPE"), { params: Promise.resolve({ id: "NOPE" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/data/benchmark-fit", () => {
  beforeEach(() => mockFit.mockReset());

  it("200 + fit result + headers on hit", async () => {
    mockFit.mockResolvedValue(FIT);
    const res = await getBenchmarkFit(req("http://x/api/data/benchmark-fit?subject=BW-FUND-S000004310&benchmark=SPY&top=5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-As-Of")).toBe("2026-04-30");
    expect(res.headers.get("X-Benchmark-As-Of")).toBe("2026-04-30");
    const body = await res.json();
    expect(body.active_share).toBe(0.41);
    expect(body.benchmark_context_id).toBe("BW-BENCH-SPY");
    expect(body.subject_source_kind).toBe("fund");
    expect(body.top_overweights[0].bw_sym_id).toBe("BW-X");
    expect(mockFit).toHaveBeenCalledWith("BW-FUND-S000004310", "SPY", { asOf: undefined, topN: 5 });
  });

  it("passes as_of through and clamps top", async () => {
    mockFit.mockResolvedValue(FIT);
    await getBenchmarkFit(req("http://x/api/data/benchmark-fit?subject=IVV&benchmark=70/30&as_of=2025-12-31&top=999"));
    expect(mockFit).toHaveBeenLastCalledWith("IVV", "70/30", { asOf: "2025-12-31", topN: 100 });
  });

  it("400 when subject or benchmark is missing", async () => {
    let res = await getBenchmarkFit(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X"));
    expect(res.status).toBe(400);
    res = await getBenchmarkFit(req("http://x/api/data/benchmark-fit?benchmark=SPY"));
    expect(res.status).toBe(400);
  });

  it("400 on a malformed as_of", async () => {
    const res = await getBenchmarkFit(req("http://x/api/data/benchmark-fit?subject=BW-FUND-X&benchmark=SPY&as_of=last-week"));
    expect(res.status).toBe(400);
  });

  it("404 when the benchmark/subject surface is missing", async () => {
    mockFit.mockResolvedValue(null);
    const res = await getBenchmarkFit(req("http://x/api/data/benchmark-fit?subject=BW-FUND-ZZZ&benchmark=NOPE"));
    expect(res.status).toBe(404);
  });
});
