/**
 * In-process zarr caches follow CURRENT (ERM3-75 increment 5 review, item d).
 *
 * Before: the 30-minute group / plane / roster caches keyed on the store
 * basename, so after a flip a reader kept serving groups from the old slot
 * for up to 30 minutes, next to groups opened fresh from the new slot. Now
 * they key on the resolved prefix (slot + release id from CURRENT): a flip,
 * a rollback, or a re-publish into the same slot is a miss within one
 * CURRENT TTL. With the switch off the keys are the fixed prefix, as before.
 *
 * GCS is an in-memory object map behind a mocked @google-cloud/storage; the
 * stores are tiny consolidated zarr v2 groups.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const objects = vi.hoisted(() => new Map<string, Uint8Array | string>());

vi.mock("@google-cloud/storage", () => {
  class File {
    constructor(private readonly name: string) {}
    async download(opts?: { start?: number; end?: number }): Promise<[Buffer]> {
      const v = objects.get(this.name);
      if (v === undefined) {
        const e = new Error("No such object") as Error & { code?: number };
        e.code = 404;
        throw e;
      }
      const buf = typeof v === "string" ? Buffer.from(v, "utf8") : Buffer.from(v);
      if (opts && opts.start !== undefined) return [buf.subarray(opts.start, (opts.end ?? buf.length - 1) + 1)];
      return [buf];
    }
  }
  class Bucket {
    file(name: string) {
      return new File(name);
    }
  }
  class Storage {
    bucket() {
      return new Bucket();
    }
  }
  return { Storage };
});

import { resetZarrReleaseSlotCache, resolveZarrGcsPrefix, zarrPrefixCacheKey } from "@/lib/dal/zarr-release-slots";
import { _openZarrGroupForTest, _zarrGroupCacheKeysForTest } from "@/lib/dal/zarr-reader";
import {
  _openCohortGroupForTest,
  _readCohortPlaneForTest,
  resetCohortZarrCaches,
} from "@/lib/dal/cohort-zarr-reader";
import { zarrCohortsBasename } from "@/lib/zarr-config";

const ENV_KEYS = ["ZARR_GCS_PREFIX", "ZARR_GCS_RELEASE_SLOTS", "ZARR_GCS_CURRENT_TTL_MS"] as const;
const saved = new Map<string, string | undefined>();
for (const k of ENV_KEYS) saved.set(k, process.env[k]);

/** A consolidated zarr v2 group with one attr and, optionally, one 2x2 float32 array `v`. */
function putStore(prefix: string, release: string, plane?: number[]): void {
  const metadata: Record<string, unknown> = {
    ".zgroup": { zarr_format: 2 },
    ".zattrs": { release },
  };
  if (plane) {
    metadata["v/.zarray"] = {
      zarr_format: 2,
      shape: [2, 2],
      chunks: [2, 2],
      dtype: "<f4",
      compressor: null,
      fill_value: "NaN",
      order: "C",
      filters: null,
    };
    metadata["v/.zattrs"] = {};
    objects.set(`${prefix}/v/0.0`, new Uint8Array(new Float32Array(plane).buffer));
  }
  objects.set(`${prefix}/.zmetadata`, JSON.stringify({ zarr_consolidated_format: 1, metadata }));
}

function setCurrent(slot: "a" | "b", release: string): void {
  objects.set("eodhd/CURRENT", JSON.stringify({ slot, release_id: release }));
}

beforeEach(() => {
  objects.clear();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.ZARR_GCS_PREFIX = "rm_api_data/eodhd";
  process.env.ZARR_GCS_CURRENT_TTL_MS = "0"; // every resolve re-reads CURRENT: the flip is visible at once
  resetZarrReleaseSlotCache();
  resetCohortZarrCaches();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetZarrReleaseSlotCache();
  resetCohortZarrCaches();
});

describe("zarrPrefixCacheKey", () => {
  it("is the fixed prefix when not resolved through CURRENT, slot+release when it is", () => {
    expect(zarrPrefixCacheKey({ bucket: "b", basePath: "eodhd" })).toBe("b/eodhd");
    expect(zarrPrefixCacheKey({ bucket: "b", basePath: "eodhd/slots/a", release: "a:r1" })).toBe(
      "b/eodhd/slots/a@a:r1",
    );
  });
});

describe("zarr-reader group cache", () => {
  it("switch off: one key per store on the fixed prefix, as before", async () => {
    putStore("eodhd/ds_t_off.zarr", "fixed");
    const g = await _openZarrGroupForTest("ds_t_off.zarr");
    expect((g?.attrs as Record<string, unknown>).release).toBe("fixed");
    expect(_zarrGroupCacheKeysForTest()).toContain("rm_api_data/eodhd|ds_t_off.zarr");
  });

  it("a flip, a rollback and a re-publish into the same slot each reach the right release", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    putStore("eodhd/slots/a/ds_t_flip.zarr", "r1");
    putStore("eodhd/slots/b/ds_t_flip.zarr", "r2");
    const attrs = async () =>
      ((await _openZarrGroupForTest("ds_t_flip.zarr"))?.attrs as Record<string, unknown>).release;

    setCurrent("a", "r1");
    expect(await attrs()).toBe("r1");
    setCurrent("b", "r2"); // flip: before the fix the basename-keyed cache kept returning r1 for 30 min
    expect(await attrs()).toBe("r2");
    setCurrent("a", "r1"); // rollback: slot a still holds r1
    expect(await attrs()).toBe("r1");
    putStore("eodhd/slots/a/ds_t_flip.zarr", "r3"); // the next publish overwrote slot a
    setCurrent("a", "r3");
    expect(await attrs()).toBe("r3");
  });

  it("one resolved prefix serves every store of one response", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    putStore("eodhd/slots/a/ds_t_one.zarr", "r1");
    putStore("eodhd/slots/a/ds_t_two.zarr", "r1");
    putStore("eodhd/slots/b/ds_t_two.zarr", "r2");
    setCurrent("a", "r1");
    const prefix = await resolveZarrGcsPrefix();
    const one = await _openZarrGroupForTest("ds_t_one.zarr", prefix);
    setCurrent("b", "r2"); // flips between the two opens of one response
    const two = await _openZarrGroupForTest("ds_t_two.zarr", prefix);
    expect((one?.attrs as Record<string, unknown>).release).toBe("r1");
    expect((two?.attrs as Record<string, unknown>).release).toBe("r1");
  });
});

describe("cohort-zarr-reader caches", () => {
  it("group and decoded planes follow the flip", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    const base = zarrCohortsBasename();
    putStore(`eodhd/slots/a/${base}`, "r1", [1, 2, 3, 4]);
    putStore(`eodhd/slots/b/${base}`, "r2", [5, 6, 7, 8]);

    setCurrent("a", "r1");
    const ga = await _openCohortGroupForTest();
    expect((ga?.attrs as Record<string, unknown>).release).toBe("r1");
    expect(Array.from((await _readCohortPlaneForTest(ga!, "v", 2, 2)) ?? [])).toEqual([1, 2, 3, 4]);

    setCurrent("b", "r2");
    const gb = await _openCohortGroupForTest();
    expect((gb?.attrs as Record<string, unknown>).release).toBe("r2");
    // before the fix the plane cache keyed on the variable name alone and returned slot a's plane
    expect(Array.from((await _readCohortPlaneForTest(gb!, "v", 2, 2)) ?? [])).toEqual([5, 6, 7, 8]);
  });
});
