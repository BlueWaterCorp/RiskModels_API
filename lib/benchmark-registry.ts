/**
 * Benchmark readiness registry (bench_active_signals.md follow-up).
 *
 * Only benchmarks with good history (teo depth + non-hollow trailing teos)
 * may be served. Every bench id served by /api/data/benchmark-fit has an
 * entry here; any bench NOT in the registry defaults to `"development"`
 * (fail-closed — new benches are blocked until explicitly promoted after a
 * GCS history check).
 *
 * Keying: static benches by resolved `bw_bench_id`; the endogenous bench by
 * `ff_own`; style cells by `cell_<slug>`. The `all` fan-out is not an entry —
 * it omits development members with reason `under_development`.
 *
 * Statuses are set from real GCS evidence (see PR #270): store audits of
 * `bw_bench_id/<id>/ds_ph.zarr` (teo depth, constituents at the latest teo,
 * hollow trailing teos) and `equity_style_9box/<Cell>/ds_symbols.zarr` (teo
 * depth, MV weights at the latest teo).
 */

export type BenchStatus = "live" | "development";

export interface BenchRegistryEntry {
  /** Canonical bench id: bw_bench_id | "ff_own" | "cell_<slug>". */
  id: string;
  status: BenchStatus;
  /** Minimum teo depth expected once the surface is complete (audit aid). */
  min_teos?: number;
  notes?: string;
}

/**
 * Static-bench writer staleness (2026-07-20 audit): SPY + EQ70-30 have 1740
 * teos of history but the trailing 8 teo columns are hollow (constituents
 * drop 492/2730 → 0 after 2026-05-19). EQ-LARGE-VALUE-60-40 is a single-teo
 * surface (2026-05-11, 907 constituents) with no history depth and no entry
 * in the API alias catalog. All three stay blocked until the writer fixes
 * land (Funds_DAG follow-up).
 */
const WRITER_STALENESS_NOTE =
  "trailing teos hollow — writer staleness, Funds_DAG follow-up";

/**
 * 2026-07-20 cell audit: Large_* / Small_* stores carry 249 teos
 * (2005-09-30..2026-05-31) with live MV weights at the latest teo and no
 * hollow trailing teos → live. The Mid cells' GCS folders are named
 * `Mid-Cap_*` while the canonical slug→path mapping resolves `Mid_*`
 * (store 404) → development until the naming mismatch is resolved.
 */
export const BENCHMARK_READINESS_REGISTRY: readonly BenchRegistryEntry[] = [
  // --- static bw_bench_id surfaces ---
  {
    id: "BW-BENCH-SPY",
    status: "development",
    notes: WRITER_STALENESS_NOTE,
  },
  {
    id: "BW-BENCH-EQ70-30",
    status: "development",
    notes: WRITER_STALENESS_NOTE,
  },
  {
    id: "BW-BENCH-EQ-LARGE-VALUE-60-40",
    status: "development",
    min_teos: 12,
    notes:
      "single-teo surface (2026-05-11) — no history depth; also absent from the API alias catalog",
  },

  // --- custom benches ---
  {
    id: "ff_own",
    status: "live",
    notes: "verified 2026-07-20: cap_coverage 0.996 on BW-FUND-S000004310",
  },
  { id: "cell_large-value", status: "live" },
  { id: "cell_large-blend", status: "live" },
  { id: "cell_large-growth", status: "live" },
  {
    id: "cell_mid-value",
    status: "development",
    notes:
      "GCS store is equity_style_9box/Mid-Cap_Value but the slug→path mapping resolves Mid_Value (404) — writer naming mismatch",
  },
  {
    id: "cell_mid-blend",
    status: "development",
    notes:
      "GCS store is equity_style_9box/Mid-Cap_Blend but the slug→path mapping resolves Mid_Blend (404) — writer naming mismatch",
  },
  {
    id: "cell_mid-growth",
    status: "development",
    notes:
      "GCS store is equity_style_9box/Mid-Cap_Growth but the slug→path mapping resolves Mid_Growth (404) — writer naming mismatch",
  },
  { id: "cell_small-value", status: "live" },
  { id: "cell_small-blend", status: "live" },
  { id: "cell_small-growth", status: "live" },
];

const _BY_ID = new Map(BENCHMARK_READINESS_REGISTRY.map((e) => [e.id, e]));

/**
 * Readiness for one bench id. Fail-closed: ids with no registry entry are
 * `development` — new benches must be explicitly promoted after a GCS
 * history audit.
 */
export function getBenchReadiness(benchId: string): BenchRegistryEntry {
  return (
    _BY_ID.get(benchId) ?? {
      id: benchId,
      status: "development",
      notes: "not in the readiness registry (fail-closed default)",
    }
  );
}

export function isBenchLive(benchId: string): boolean {
  return getBenchReadiness(benchId).status === "live";
}
