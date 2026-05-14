/**
 * lib/dal/benchmark-catalog — committed-mirror loader + resolveBenchmarkId rewire.
 *
 * The catalog file at `mcp/data/benchmark_master.json` is generated from
 * `Funds_DAG/configs/benchmark_universe.yaml` (cross-repo mirror, same pattern as
 * the OpenAPI/capabilities mirror). These tests verify (a) the loader correctly
 * exposes aliases + contexts from the committed file and (b) `resolveBenchmarkId`
 * is now backed by the catalog (the previously-hardcoded BENCHMARK_ALIASES const
 * is gone — `benchmark_v2_followups.md` #1).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  _reloadBenchmarkCatalog,
  benchmarkCatalogMetadata,
  getBenchmarkContext,
  listBenchmarkContexts,
  lookupBenchmarkAlias,
} from "@/lib/dal/benchmark-catalog";
import { resolveBenchmarkId } from "@/lib/dal/funds-zarr-reader";

beforeAll(() => _reloadBenchmarkCatalog());

describe("benchmark-catalog (committed mirror)", () => {
  it("loads the committed mcp/data/benchmark_master.json with a stable schema", () => {
    const meta = benchmarkCatalogMetadata();
    expect(meta.schema_version).toBe("benchmark-master/1.0");
    expect(meta.n_contexts).toBeGreaterThanOrEqual(2);
    expect(meta.path).toMatch(/mcp\/data\/benchmark_master\.json$/);
  });

  it("resolves the v1 aliases (case-insensitive)", () => {
    expect(lookupBenchmarkAlias("SPY")).toBe("BW-BENCH-SPY");
    expect(lookupBenchmarkAlias("spy")).toBe("BW-BENCH-SPY");
    expect(lookupBenchmarkAlias("S&P 500")).toBe("BW-BENCH-SPY");
    expect(lookupBenchmarkAlias("IVV")).toBe("BW-BENCH-SPY");
    expect(lookupBenchmarkAlias("70/30")).toBe("BW-BENCH-EQ70-30");
    expect(lookupBenchmarkAlias("EQ70-30")).toBe("BW-BENCH-EQ70-30");
    expect(lookupBenchmarkAlias("nope-does-not-exist")).toBeNull();
    expect(lookupBenchmarkAlias("")).toBeNull();
  });

  it("getBenchmarkContext returns the full record", () => {
    const spy = getBenchmarkContext("BW-BENCH-SPY");
    expect(spy).not.toBeNull();
    expect(spy!.benchmark_kind).toBe("index_proxy");
    expect(spy!.proxy?.ref).toBe("IVV");
    expect(spy!.aliases).toContain("SPY");
    const blend = getBenchmarkContext("BW-BENCH-EQ70-30");
    expect(blend!.benchmark_kind).toBe("blend");
    expect(blend!.components.map((c) => c.ref).sort()).toEqual(["IWB", "IWM"]);
    expect(getBenchmarkContext("BW-BENCH-NOPE")).toBeNull();
  });

  it("listBenchmarkContexts returns every catalog entry", () => {
    const all = listBenchmarkContexts();
    const ids = all.map((c) => c.bw_bench_id).sort();
    expect(ids).toContain("BW-BENCH-SPY");
    expect(ids).toContain("BW-BENCH-EQ70-30");
    expect(all.length).toBe(benchmarkCatalogMetadata().n_contexts);
  });

  it("resolveBenchmarkId uses the catalog (alias + BW-BENCH- passthrough; degrades cleanly)", () => {
    expect(resolveBenchmarkId("SPY")).toBe("BW-BENCH-SPY");
    expect(resolveBenchmarkId("70/30")).toBe("BW-BENCH-EQ70-30");
    expect(resolveBenchmarkId("BW-BENCH-EQ70-30")).toBe("BW-BENCH-EQ70-30");
    expect(resolveBenchmarkId("bw-bench-anything-uppercased")).toBe("BW-BENCH-ANYTHING-UPPERCASED");  // passthrough
    expect(resolveBenchmarkId("totally-unknown")).toBeNull();
    expect(resolveBenchmarkId("")).toBeNull();
  });
});
