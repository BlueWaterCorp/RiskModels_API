/**
 * Per-domain GCS prefix resolution (Funds_DAG #76 split).
 *
 * The writer moved filer/ETF/benchmark trees out of the shared
 * `rm_api_data/ERM3_Funds` root into `ERM3_Filers` / `ERM3_ETFs` /
 * `ERM3_Reference`, but publishes them only on the next full/nuclear run.
 * The reader therefore resolves an ordered candidate list per domain:
 * the per-domain override first, the shared tree as fallback — a dual-read
 * window that follows the split automatically once the new trees land.
 */

import { afterEach, describe, expect, it } from "vitest";

import { domainZarrPrefixCandidates } from "@/lib/dal/funds-zarr-reader";

const ENV_KEYS = [
  "ZARR_FUNDS_GCS_PREFIX",
  "ZARR_FILERS_GCS_PREFIX",
  "ZARR_ETFS_GCS_PREFIX",
  "ZARR_BENCH_GCS_PREFIX",
] as const;

const saved = new Map<string, string | undefined>();

for (const k of ENV_KEYS) saved.set(k, process.env[k]);

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("domainZarrPrefixCandidates", () => {
  it("uses only the default shared prefix when no env is set", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(domainZarrPrefixCandidates("ZARR_FILERS_GCS_PREFIX")).toEqual([
      { bucket: "rm_api_data", basePath: "ERM3_Funds" },
    ]);
  });

  it("uses only the shared ZARR_FUNDS_GCS_PREFIX when the domain env is unset", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ZARR_FUNDS_GCS_PREFIX = "custom_bucket/custom_tree";
    expect(domainZarrPrefixCandidates("ZARR_ETFS_GCS_PREFIX")).toEqual([
      { bucket: "custom_bucket", basePath: "custom_tree" },
    ]);
  });

  it("orders the domain override first, shared tree as fallback (the #76 dual-read window)", () => {
    process.env.ZARR_FUNDS_GCS_PREFIX = "rm_api_data/ERM3_Funds";
    process.env.ZARR_FILERS_GCS_PREFIX = "rm_api_data/ERM3_Filers";
    process.env.ZARR_ETFS_GCS_PREFIX = "rm_api_data/ERM3_ETFs";
    process.env.ZARR_BENCH_GCS_PREFIX = "rm_api_data/ERM3_Reference";

    expect(domainZarrPrefixCandidates("ZARR_FILERS_GCS_PREFIX")).toEqual([
      { bucket: "rm_api_data", basePath: "ERM3_Filers" },
      { bucket: "rm_api_data", basePath: "ERM3_Funds" },
    ]);
    expect(domainZarrPrefixCandidates("ZARR_ETFS_GCS_PREFIX")).toEqual([
      { bucket: "rm_api_data", basePath: "ERM3_ETFs" },
      { bucket: "rm_api_data", basePath: "ERM3_Funds" },
    ]);
    expect(domainZarrPrefixCandidates("ZARR_BENCH_GCS_PREFIX")).toEqual([
      { bucket: "rm_api_data", basePath: "ERM3_Reference" },
      { bucket: "rm_api_data", basePath: "ERM3_Funds" },
    ]);
  });

  it("treats a blank domain override as unset", () => {
    process.env.ZARR_FUNDS_GCS_PREFIX = "rm_api_data/ERM3_Funds";
    process.env.ZARR_FILERS_GCS_PREFIX = "   ";
    expect(domainZarrPrefixCandidates("ZARR_FILERS_GCS_PREFIX")).toEqual([
      { bucket: "rm_api_data", basePath: "ERM3_Funds" },
    ]);
  });

  it("collapses to a single candidate when the override equals the shared prefix", () => {
    process.env.ZARR_FUNDS_GCS_PREFIX = "rm_api_data/ERM3_Funds";
    process.env.ZARR_FILERS_GCS_PREFIX = "rm_api_data/ERM3_Funds";
    expect(domainZarrPrefixCandidates("ZARR_FILERS_GCS_PREFIX")).toEqual([
      { bucket: "rm_api_data", basePath: "ERM3_Funds" },
    ]);
  });

  it("strips a trailing slash from the basePath", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ZARR_FILERS_GCS_PREFIX = "rm_api_data/ERM3_Filers/";
    expect(
      domainZarrPrefixCandidates("ZARR_FILERS_GCS_PREFIX")[0]!.basePath,
    ).toBe("ERM3_Filers");
  });
});
