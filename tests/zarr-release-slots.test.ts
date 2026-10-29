/**
 * Release-slot resolution (ERM3-75 increment 5).
 *
 * The publisher writes a release into `{base}/slots/{a,b}` and flips
 * `{base}/CURRENT`; with ZARR_GCS_RELEASE_SLOTS=1 the stocks-side readers
 * resolve the base through CURRENT (cached for ZARR_GCS_CURRENT_TTL_MS).
 * Default off: the fixed base, no GCS call.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseZarrCurrentPointer,
  zarrCurrentObjectPath,
  zarrReleaseSlotsEnabled,
  zarrSlotBasePath,
} from "@/lib/zarr-config";
import {
  resetZarrReleaseSlotCache,
  resolveZarrGcsPrefix,
  type CurrentFetcher,
} from "@/lib/dal/zarr-release-slots";

const ENV_KEYS = ["ZARR_GCS_PREFIX", "ZARR_GCS_RELEASE_SLOTS", "ZARR_GCS_CURRENT_TTL_MS"] as const;
const saved = new Map<string, string | undefined>();
for (const k of ENV_KEYS) saved.set(k, process.env[k]);

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  resetZarrReleaseSlotCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetZarrReleaseSlotCache();
});

function fetcherReturning(text: string | null): { fetcher: CurrentFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: CurrentFetcher = async (bucket, objectPath) => {
    calls.push(`${bucket}/${objectPath}`);
    return text;
  };
  return { fetcher, calls };
}

describe("zarr-config slot helpers", () => {
  it("switch is off by default", () => {
    expect(zarrReleaseSlotsEnabled()).toBe(false);
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    expect(zarrReleaseSlotsEnabled()).toBe(true);
    process.env.ZARR_GCS_RELEASE_SLOTS = "0";
    expect(zarrReleaseSlotsEnabled()).toBe(false);
  });

  it("builds the CURRENT and slot paths under the base", () => {
    expect(zarrCurrentObjectPath("eodhd")).toBe("eodhd/CURRENT");
    expect(zarrSlotBasePath("eodhd", "b")).toBe("eodhd/slots/b");
    expect(zarrSlotBasePath("staging/eodhd/", "a")).toBe("staging/eodhd/slots/a");
    expect(zarrCurrentObjectPath("")).toBe("CURRENT");
  });

  it("parses CURRENT and rejects anything that is not a slot pointer", () => {
    expect(parseZarrCurrentPointer('{"slot":"a","release_id":"r1","parent_release_id":"r0"}')).toEqual({
      slot: "a",
      release_id: "r1",
      parent_release_id: "r0",
    });
    expect(parseZarrCurrentPointer('{"slot":"b"}')).toEqual({ slot: "b" });
    expect(parseZarrCurrentPointer('{"slot":"c"}')).toBeNull();
    expect(parseZarrCurrentPointer("not json")).toBeNull();
    expect(parseZarrCurrentPointer("[]")).toBeNull();
  });
});

describe("resolveZarrGcsPrefix", () => {
  it("returns the fixed prefix without touching GCS when the switch is off", async () => {
    const { fetcher, calls } = fetcherReturning('{"slot":"b"}');
    expect(await resolveZarrGcsPrefix({ fetcher })).toEqual({ bucket: "rm_api_data", basePath: "eodhd" });
    expect(calls).toEqual([]);
  });

  it("resolves the slot CURRENT points at when the switch is on", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    const { fetcher, calls } = fetcherReturning('{"slot":"b","release_id":"run-2"}');
    expect(await resolveZarrGcsPrefix({ fetcher })).toEqual({
      bucket: "rm_api_data",
      basePath: "eodhd/slots/b",
    });
    expect(calls).toEqual(["rm_api_data/eodhd/CURRENT"]);
  });

  it("honours ZARR_GCS_PREFIX for the CURRENT location (staging recipe)", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    process.env.ZARR_GCS_PREFIX = "rm_api_data/staging_e75/eodhd";
    const { fetcher, calls } = fetcherReturning('{"slot":"a"}');
    expect(await resolveZarrGcsPrefix({ fetcher })).toEqual({
      bucket: "rm_api_data",
      basePath: "staging_e75/eodhd/slots/a",
    });
    expect(calls).toEqual(["rm_api_data/staging_e75/eodhd/CURRENT"]);
  });

  it("caches CURRENT for the TTL and re-reads after it", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    process.env.ZARR_GCS_CURRENT_TTL_MS = "1000";
    let text = '{"slot":"a"}';
    const calls: string[] = [];
    const fetcher: CurrentFetcher = async (b, o) => {
      calls.push(`${b}/${o}`);
      return text;
    };
    let t = 10_000;
    const now = () => t;
    expect((await resolveZarrGcsPrefix({ fetcher, now })).basePath).toBe("eodhd/slots/a");
    text = '{"slot":"b"}';
    t += 500;
    expect((await resolveZarrGcsPrefix({ fetcher, now })).basePath).toBe("eodhd/slots/a");
    expect(calls).toHaveLength(1);
    t += 600;
    expect((await resolveZarrGcsPrefix({ fetcher, now })).basePath).toBe("eodhd/slots/b");
    expect(calls).toHaveLength(2);
  });

  it("falls back to the fixed prefix when CURRENT is absent or invalid", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    expect(await resolveZarrGcsPrefix({ fetcher: fetcherReturning(null).fetcher })).toEqual({
      bucket: "rm_api_data",
      basePath: "eodhd",
    });
    resetZarrReleaseSlotCache();
    expect(await resolveZarrGcsPrefix({ fetcher: fetcherReturning('{"slot":"zz"}').fetcher })).toEqual({
      bucket: "rm_api_data",
      basePath: "eodhd",
    });
  });

  it("keeps the last resolved slot when a later CURRENT read fails", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    process.env.ZARR_GCS_CURRENT_TTL_MS = "0";
    let fail = false;
    const fetcher: CurrentFetcher = async () => {
      if (fail) throw new Error("boom");
      return '{"slot":"b"}';
    };
    expect((await resolveZarrGcsPrefix({ fetcher })).basePath).toBe("eodhd/slots/b");
    fail = true;
    expect((await resolveZarrGcsPrefix({ fetcher })).basePath).toBe("eodhd/slots/b");
    resetZarrReleaseSlotCache();
    expect((await resolveZarrGcsPrefix({ fetcher })).basePath).toBe("eodhd");
  });

  it("coalesces concurrent resolutions into one CURRENT read", async () => {
    process.env.ZARR_GCS_RELEASE_SLOTS = "1";
    const { fetcher, calls } = fetcherReturning('{"slot":"a"}');
    const results = await Promise.all([
      resolveZarrGcsPrefix({ fetcher }),
      resolveZarrGcsPrefix({ fetcher }),
      resolveZarrGcsPrefix({ fetcher }),
    ]);
    expect(results.every((r) => r.basePath === "eodhd/slots/a")).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
