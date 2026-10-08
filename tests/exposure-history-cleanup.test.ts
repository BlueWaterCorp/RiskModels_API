import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("tests must not reach Supabase");
  },
}));

import {
  cleanupExposureHistory,
  prunableHits,
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
const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const key = (c: string) => c.repeat(32);
const BUILD = "2026-10-08T00:00:00Z";
const OLD_BUILD = "2026-09-08T00:00:00Z";
const cur = exposureHistoryBuildTag(BUILD);
const old = exposureHistoryBuildTag(OLD_BUILD);

function file(name: string, age: number): StorageEntry {
  return { name, id: `id-${name}`, created_at: at(age), updated_at: at(age) };
}
const parquet = (age: number) => [file("names.0123456789abcdef.parquet", age), file("cov.0123456789abcdef.parquet", age)];

/** In-memory bucket with real offset pagination. */
function memBucket(folders: Record<string, StorageEntry[]>, rootFiles: StorageEntry[] = [], pageCap = Infinity) {
  const state = new Map(Object.entries(folders).map(([k, v]) => [k, [...v]]));
  const log: string[] = [];
  const api: BucketApi = {
    list: async (prefix, { limit, offset }) => {
      let all: StorageEntry[];
      if (prefix === "") {
        all = [...[...state.keys()].map((name) => ({ name, id: null })), ...rootFiles];
      } else if (prefix.endsWith("/hits")) {
        all = (state.get(prefix.slice(0, -5)) ?? [])
          .filter((o) => o.name.startsWith("hits/"))
          .map((o) => ({ ...o, name: o.name.slice(5) }));
      } else {
        const objs = state.get(prefix) ?? [];
        all = objs.filter((o) => !o.name.startsWith("hits/"));
        if (objs.some((o) => o.name.startsWith("hits/"))) all.push({ name: "hits", id: null });
        all.sort((x, y) => x.name.localeCompare(y.name));
      }
      return { data: all.slice(offset, offset + Math.min(limit, pageCap)), error: null };
    },
    upload: async (path, _body) => {
      log.push(`upload ${path}`);
      const [k, ...rest] = path.split("/");
      const n = rest.join("/");
      state.set(k, [...(state.get(k) ?? []), { name: n, id: `id-${n}`, created_at: NOW.toISOString(), updated_at: NOW.toISOString() }]);
      return { error: null };
    },
    remove: async (paths) => {
      log.push(`remove ${paths.join(",")}`);
      for (const p of paths) {
        const [k, ...rest] = p.split("/");
        const n = rest.join("/");
        state.set(k, (state.get(k) ?? []).filter((o) => o.name !== n));
      }
      return { error: null };
    },
  };
  return { api, state, log };
}

describe("judgeFolder", () => {
  const now = NOW.getTime();

  it("keeps a folder with activity inside the URL TTL plus margin, whatever its build or creation date", () => {
    const objs = [...parquet(30 * D), file(`hits/${old}.1`, 30 * 60 * 1000)];
    expect(judgeFolder(objs, now, 7, cur)).toEqual({ action: "keep", reason: "active" });
    expect(guardMs()).toBe(3 * H);
  });

  it("condemns past the max age, and for another panel build", () => {
    expect(judgeFolder([...parquet(8 * D), file(`hits/${cur}.1`, 8 * D)], now, 7, cur)).toEqual({ action: "condemn", reason: "age" });
    expect(judgeFolder([...parquet(8 * D)], now, 10, cur)).toEqual({ action: "keep", reason: "young" });
    expect(judgeFolder([...parquet(2 * D), file(`hits/${old}.1`, 4 * H)], now, 7, cur)).toEqual({ action: "condemn", reason: "stale_build" });
    expect(judgeFolder([...parquet(2 * D), file(`hits/${old}.1`, 4 * H)], now, 7, null)).toEqual({ action: "keep", reason: "young" });
  });

  it("keeps a folder that has any current-build marker, and an unmarked folder under the max age", () => {
    expect(judgeFolder([...parquet(3 * D), file(`hits/${old}.1`, 3 * D), file(`hits/${cur}.2`, 3 * D)], now, 7, cur).action).toBe("keep");
    expect(judgeFolder(parquet(3 * D), now, 7, cur).action).toBe("keep");
  });

  it("deletes a condemned folder only 12 h after condemnation and only with no activity since", () => {
    const base = [...parquet(9 * D), file(`hits/${cur}.1`, 9 * D)];
    expect(judgeFolder([...base, file("condemned", 1 * H)], now, 7, cur)).toEqual({ action: "keep", reason: "condemned_recently" });
    expect(judgeFolder([...base, file("condemned", 11 * H)], now, 7, cur)).toEqual({ action: "keep", reason: "condemned_recently" });
    expect(judgeFolder([...base, file("condemned", 1 * D)], now, 7, cur)).toEqual({ action: "delete" });
    // A hit after condemnation reprieves the folder, even at the deletion run.
    expect(judgeFolder([...base, file("condemned", 1 * D), file(`hits/${cur}.2`, 23 * H)], now, 7, cur)).toEqual({ action: "reprieve" });
  });

  it("keeps folders with missing timestamps and empty folders", () => {
    const objs = [file("names.parquet", 30 * D), { name: "cov.parquet", id: "x", created_at: null, updated_at: null }];
    expect(judgeFolder(objs, now, 7, cur)).toEqual({ action: "keep", reason: "no_timestamp" });
    expect(judgeFolder([], now, 7, cur)).toEqual({ action: "keep", reason: "empty" });
  });

  it("treats activity just inside the guard as active, and clamps max age to one day", () => {
    expect(judgeFolder(parquet(guardMs() - 1), now, 7, cur).action).toBe("keep");
    expect(judgeFolder(parquet(12 * H), now, 0, null).action).toBe("keep");
    expect(judgeFolder(parquet(25 * H), now, 0, null).action).toBe("condemn");
  });
});

describe("prunableHits", () => {
  it("prunes markers older than the guard but keeps the newest per build tag", () => {
    const objs = [
      ...parquet(5 * D),
      file(`hits/${cur}.1`, 2 * D),
      file(`hits/${cur}.2`, 1 * D),
      file(`hits/${cur}.3`, 4 * H),
      file(`hits/${old}.1`, 9 * D),
      file(`hits/${old}.2`, 8 * D),
    ];
    expect(prunableHits(objs, NOW.getTime()).sort()).toEqual([`hits/${cur}.1`, `hits/${cur}.2`, `hits/${old}.1`]);
    // A marker inside the guard is never pruned even when a newer one exists.
    expect(prunableHits([file(`hits/${cur}.1`, 1 * H), file(`hits/${cur}.2`, 0)], NOW.getTime())).toEqual([]);
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
  it("condemns on one run and deletes on the next; never touches root files or other names", async () => {
    const { api, state } = memBucket(
      {
        [key("a")]: parquet(10 * D), // age
        [key("b")]: [...parquet(2 * D), file(`hits/${old}.1`, 2 * D)], // stale build
        [key("c")]: [...parquet(10 * D), file(`hits/${old}.1`, 10 * 60 * 1000)], // hit 10 min ago
        [key("d")]: [...parquet(1 * D), file(`hits/${cur}.1`, 1 * D)], // current, young
        "not-a-cache-key": parquet(100 * D),
      },
      [file("stray.parquet", 100 * D)],
    );
    const r1 = await cleanupExposureHistory(api, { now: NOW, currentBuiltUtc: BUILD });
    expect(r1).toMatchObject({ folders: 4, scanned: 4, condemned: 2, deleted: 0, reasons: { age: 1, stale_build: 1 }, complete: true });
    expect(state.get(key("a"))!.map((o) => o.name)).toContain("condemned");

    // Next day: the condemned markers are a day old, nothing touched since.
    const r2 = await cleanupExposureHistory(api, { now: new Date(NOW.getTime() + D), currentBuiltUtc: BUILD });
    expect(r2.deleted).toBe(2);
    expect(state.get(key("a"))).toEqual([]);
    expect(state.get(key("b"))).toEqual([]);
    // c: hit 10 min before run 1, so it is a day idle at run 2 and only now condemned (old build).
    expect(state.get(key("c"))!.map((o) => o.name)).toContain("condemned");
    expect(state.get(key("c"))!.length).toBe(4);
    expect(state.get(key("d"))!.length).toBe(3);
    expect(state.get("not-a-cache-key")!.length).toBe(2);
  });

  it("reads legacy names.parquet / hit.<tag> folders", async () => {
    const legacy = [file("names.parquet", 2 * D), file("cov.parquet", 2 * D), file(`hit.${old}`, 2 * D)];
    expect(judgeFolder(legacy, NOW.getTime(), 7, cur)).toEqual({ action: "condemn", reason: "stale_build" });
  });

  it("a file uploaded after the deletion listing survives the delete", async () => {
    const k = key("9");
    const { api, state } = memBucket({ [k]: [...parquet(9 * D), file(`hits/${cur}.1`, 9 * D), file("condemned", 1 * D)] });
    const list = api.list.bind(api);
    let injected = false;
    api.list = async (prefix, o) => {
      const r = await list(prefix, o);
      if (prefix === `${k}/hits` && !injected) {
        injected = true; // route uploads a new generation right after cleanup listed the folder
        state.get(k)!.push(file("names.feedfacefeedface.parquet", 0), file("cov.feedfacefeedface.parquet", 0));
      }
      return r;
    };
    const r = await cleanupExposureHistory(api, { now: NOW, currentBuiltUtc: BUILD });
    expect(r.deleted).toBe(1);
    expect(state.get(k)!.map((o) => o.name).sort()).toEqual(["cov.feedfacefeedface.parquet", "names.feedfacefeedface.parquet"]);
  });

  it("reprieves a condemned folder that was hit before the deletion run", async () => {
    const { api, state } = memBucket({ [key("e")]: [...parquet(9 * D), file("condemned", 1 * D), file(`hits/${cur}.9`, 2 * H)] });
    const r = await cleanupExposureHistory(api, { now: NOW, currentBuiltUtc: BUILD });
    expect(r).toMatchObject({ reprieved: 1, deleted: 0 });
    expect(state.get(key("e"))!.map((o) => o.name)).not.toContain("condemned");
  });

  it("pages through more than one page of folders, including a server that caps pages below the limit", async () => {
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [i.toString(16).padStart(32, "0"), parquet(10 * D)]));
    const r = await cleanupExposureHistory(memBucket(many).api, { now: NOW, dryRun: true });
    expect(r.folders).toBe(250);
    const capped = await cleanupExposureHistory(memBucket(many, [], 40).api, { now: NOW, dryRun: true });
    expect(capped.folders).toBe(250);
  });

  it("stops at the time budget and reports an incomplete run", async () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i.toString(16).padStart(32, "0"), parquet(10 * D)]));
    const r = await cleanupExposureHistory(memBucket(many).api, { now: NOW, budgetMs: -1 });
    expect(r).toMatchObject({ complete: false, scanned: 0 });
  });

  it("prunes old markers on kept folders during a run", async () => {
    const k = key("7");
    const { api, state } = memBucket({ [k]: [...parquet(2 * D), file(`hits/${cur}.1`, 2 * D), file(`hits/${cur}.2`, 1 * H)] });
    const r = await cleanupExposureHistory(api, { now: NOW, currentBuiltUtc: BUILD });
    expect(r).toMatchObject({ kept: 1, pruned_markers: 1 });
    expect(state.get(k)!.map((o) => o.name)).not.toContain(`hits/${cur}.1`);
  });

  it("dry run reports without writing", async () => {
    const { api, log } = memBucket({ [key("f")]: parquet(10 * D), [key("0")]: [...parquet(10 * D), file("condemned", 2 * D)] });
    const r = await cleanupExposureHistory(api, { now: NOW, dryRun: true });
    expect(r).toMatchObject({ condemned: 1, deleted: 1 });
    expect(log).toEqual([]);
  });

  it("records remove errors", async () => {
    const { api } = memBucket({ [key("1")]: [...parquet(10 * D), file("condemned", 2 * D)] });
    api.remove = async () => ({ error: { message: "boom" } });
    const r = await cleanupExposureHistory(api, { now: NOW });
    expect(r.errors[0]).toMatch(/boom/);
  });
});
