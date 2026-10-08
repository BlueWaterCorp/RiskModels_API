import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("tests must not reach Supabase");
  },
}));

import {
  cleanupExposureHistory,
  guardMs,
  judgeFolder,
  maxAgeDaysFromEnv,
  type BucketApi,
  type StorageEntry,
} from "@/lib/supabase/exposure-history-cleanup";
import { exposureHistoryBuildTag } from "@/lib/supabase/storage";

const NOW = new Date("2026-10-20T12:00:00Z");
const H = 3600 * 1000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const key = (c: string) => c.repeat(32);
const BUILD = "2026-10-08T00:00:00Z";
const OLD_BUILD = "2026-09-08T00:00:00Z";

function file(name: string, age: number): StorageEntry {
  return { name, id: `id-${name}`, created_at: ago(age), updated_at: ago(age) };
}

function fakeBucket(folders: Record<string, StorageEntry[]>, extraRoot: StorageEntry[] = []) {
  const removed: string[][] = [];
  const api: BucketApi = {
    list: async (prefix, { offset }) => {
      if (offset > 0) return { data: [], error: null };
      if (prefix === "") {
        return { data: [...Object.keys(folders).map((name) => ({ name, id: null })), ...extraRoot], error: null };
      }
      return { data: folders[prefix] ?? [], error: null };
    },
    remove: async (paths) => {
      removed.push(paths);
      return { error: null };
    },
  };
  return { api, removed };
}

describe("judgeFolder", () => {
  const cur = exposureHistoryBuildTag(BUILD);
  const old = exposureHistoryBuildTag(OLD_BUILD);

  it("never deletes a folder active within the URL TTL plus margin, whatever its build or creation date", () => {
    const objs = [file("names.parquet", 30 * D), file("cov.parquet", 30 * D), file(`hit.${old}`, 30 * 60 * 1000)];
    expect(judgeFolder(objs, NOW.getTime(), 7, cur)).toEqual({ delete: false, reason: "active" });
    expect(guardMs()).toBeGreaterThan(3600 * 1000);
  });

  it("deletes by age past the max age", () => {
    const objs = [file("names.parquet", 8 * D), file("cov.parquet", 8 * D), file(`hit.${cur}`, 8 * D)];
    expect(judgeFolder(objs, NOW.getTime(), 7, cur)).toEqual({ delete: true, reason: "age" });
    expect(judgeFolder(objs, NOW.getTime(), 10, cur)).toEqual({ delete: false, reason: "young" });
  });

  it("deletes a folder from another panel build once outside the guard", () => {
    const objs = [file("names.parquet", 2 * D), file("cov.parquet", 2 * D), file(`hit.${old}`, 3 * H)];
    expect(judgeFolder(objs, NOW.getTime(), 7, cur)).toEqual({ delete: true, reason: "stale_build" });
    expect(judgeFolder(objs, NOW.getTime(), 7, null)).toEqual({ delete: false, reason: "young" });
  });

  it("keeps a current-build folder and a folder without a marker under the max age", () => {
    expect(judgeFolder([file("names.parquet", 3 * D), file(`hit.${cur}`, 3 * D)], NOW.getTime(), 7, cur).delete).toBe(false);
    expect(judgeFolder([file("names.parquet", 3 * D), file("cov.parquet", 3 * D)], NOW.getTime(), 7, cur).delete).toBe(false);
  });

  it("keeps a folder with an object lacking timestamps, and an empty folder", () => {
    const objs = [file("names.parquet", 30 * D), { name: "cov.parquet", id: "x", created_at: null, updated_at: null }];
    expect(judgeFolder(objs, NOW.getTime(), 7, cur)).toEqual({ delete: false, reason: "no_timestamp" });
    expect(judgeFolder([], NOW.getTime(), 7, cur)).toEqual({ delete: false, reason: "empty" });
  });

  it("clamps the max age to at least one day", () => {
    const objs = [file("names.parquet", 12 * H)];
    expect(judgeFolder(objs, NOW.getTime(), 0, null).delete).toBe(false);
  });
});

describe("maxAgeDaysFromEnv", () => {
  it("defaults to 7 and clamps below 1", () => {
    expect(maxAgeDaysFromEnv(undefined)).toBe(7);
    expect(maxAgeDaysFromEnv("abc")).toBe(7);
    expect(maxAgeDaysFromEnv("3")).toBe(3);
    expect(maxAgeDaysFromEnv("0")).toBe(1);
  });
});

describe("cleanupExposureHistory", () => {
  const cur = exposureHistoryBuildTag(BUILD);
  const old = exposureHistoryBuildTag(OLD_BUILD);

  it("deletes only expired cache-key folders and never root files or other prefixes", async () => {
    const { api, removed } = fakeBucket(
      {
        [key("a")]: [file("names.parquet", 10 * D), file("cov.parquet", 10 * D)], // age
        [key("b")]: [file("names.parquet", 2 * D), file("cov.parquet", 2 * D), file(`hit.${old}`, 2 * D)], // stale build
        [key("c")]: [file("names.parquet", 10 * D), file("cov.parquet", 10 * D), file(`hit.${old}`, 10 * 60 * 1000)], // hit 10 min ago
        [key("d")]: [file("names.parquet", 1 * D), file(`hit.${cur}`, 1 * D)], // current, young
        "not-a-cache-key": [file("names.parquet", 100 * D)],
      },
      [file("stray.parquet", 100 * D)],
    );
    const r = await cleanupExposureHistory(api, { now: NOW, currentBuiltUtc: BUILD });
    expect(r.bucket).toBe("exposure-history");
    expect(r.scanned).toBe(4);
    expect(r.deleted).toBe(2);
    expect(r.reasons).toEqual({ age: 1, stale_build: 1 });
    expect(removed.flat().sort()).toEqual(
      [`${key("a")}/cov.parquet`, `${key("a")}/names.parquet`, `${key("b")}/cov.parquet`, `${key("b")}/hit.${old}`, `${key("b")}/names.parquet`].sort(),
    );
  });

  it("keeps a folder hit between the first listing and the delete", async () => {
    const k = key("e");
    let calls = 0;
    const removed: string[][] = [];
    const api: BucketApi = {
      list: async (prefix) => {
        if (prefix === "") return { data: [{ name: k, id: null }], error: null };
        calls += 1;
        const marker = calls === 1 ? file(`hit.${cur}`, 9 * D) : { ...file(`hit.${cur}`, 0), updated_at: NOW.toISOString() };
        return { data: [file("names.parquet", 9 * D), marker], error: null };
      },
      remove: async (p) => {
        removed.push(p);
        return { error: null };
      },
    };
    const r = await cleanupExposureHistory(api, { now: NOW, currentBuiltUtc: BUILD });
    expect(r.deleted).toBe(0);
    expect(removed).toEqual([]);
  });

  it("dry run reports without removing", async () => {
    const { api, removed } = fakeBucket({ [key("f")]: [file("names.parquet", 10 * D)] });
    const r = await cleanupExposureHistory(api, { now: NOW, dryRun: true });
    expect(r.deleted).toBe(1);
    expect(removed).toEqual([]);
  });
});
