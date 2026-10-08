/**
 * Real storage.ts rules (inspect / serve / write) and the real cleanup run
 * against one in-memory bucket with Storage-style timestamps and offset
 * pagination in name order.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Obj = { created_at: string; updated_at: string; body: string };
const store = new Map<string, Obj>(); // full path -> object
const clock = { t: Date.parse("2026-10-20T12:00:00Z") };
const iso = () => new Date(clock.t).toISOString();
const hooks: { afterRemove?: (paths: string[]) => Promise<void> } = {};
const bucketsSeen = new Set<string>();

function listing(prefix: string) {
  const pre = prefix ? `${prefix}/` : "";
  const files: Array<{ name: string; id: string | null; created_at?: string; updated_at?: string }> = [];
  const dirs = new Set<string>();
  for (const [p, o] of store) {
    if (!p.startsWith(pre)) continue;
    const rest = p.slice(pre.length);
    const i = rest.indexOf("/");
    if (i >= 0) dirs.add(rest.slice(0, i));
    else files.push({ name: rest, id: `id:${p}`, created_at: o.created_at, updated_at: o.updated_at });
  }
  return [...[...dirs].map((name) => ({ name, id: null })), ...files].sort((a, b) => a.name.localeCompare(b.name));
}

const fakeBucket = {
  list: async (prefix: string, opts: { limit: number; offset: number }) => ({
    data: listing(prefix).slice(opts.offset, opts.offset + opts.limit),
    error: null,
  }),
  upload: async (path: string, body: Buffer, opts: { upsert?: boolean }) => {
    const prev = store.get(path);
    if (prev && !opts.upsert) return { error: { message: "The resource already exists" } };
    // Like Storage on overwrite: keep created_at, move updated_at.
    store.set(path, { created_at: prev?.created_at ?? iso(), updated_at: iso(), body: String(body) });
    return { error: null };
  },
  remove: async (paths: string[]) => {
    for (const p of paths) store.delete(p);
    await hooks.afterRemove?.(paths);
    return { error: null };
  },
  createSignedUrl: async (path: string) =>
    store.has(path) ? { data: { signedUrl: `https://signed/${path}` }, error: null } : { data: null, error: { message: "Object not found" } },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => {
        bucketsSeen.add(bucket);
        return fakeBucket;
      },
    },
  }),
}));

import {
  exposureHistoryBuildTag,
  inspectExposureHistoryFolder,
  serveExposureHistorySet,
  writeExposureHistorySet,
} from "@/lib/supabase/storage";
import { cleanupExposureHistory, supabaseBucketApi } from "@/lib/supabase/exposure-history-cleanup";

const K = "a".repeat(32);
const BUILD = "2026-10-08T00:00:00Z";
const H = 3600 * 1000;
const D = 24 * H;
const put = (path: string, ageMs: number) => {
  const t = new Date(clock.t - ageMs).toISOString();
  store.set(path, { created_at: t, updated_at: t, body: "" });
};
const files = () => [
  { name: "names", bytes: Buffer.from("n") },
  { name: "cov", bytes: Buffer.from("c") },
];
const exists = (url: string) => store.has(url.replace("https://signed/", ""));

beforeEach(() => {
  store.clear();
  bucketsSeen.clear();
  hooks.afterRemove = undefined;
  clock.t = Date.parse("2026-10-20T12:00:00Z");
});

describe("inspect / serve / write", () => {
  it("writes cov last, serves the set on the next request, and writes a window hit marker", async () => {
    const first = await writeExposureHistorySet(K, BUILD, files());
    expect(Object.keys(first).sort()).toEqual(["cov", "names"]);
    clock.t += 60_000;
    const hit = await serveExposureHistorySet(K, BUILD, ["cov"]);
    expect(hit).toEqual(first);
    const hits = [...store.keys()].filter((p) => p.startsWith(`${K}/hits/`));
    // One marker per 10-minute window (the window id comes from the server clock).
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(new RegExp(`^${K}/hits/${exposureHistoryBuildTag(BUILD)}\\.\\d+$`));
    expect([...bucketsSeen]).toEqual(["exposure-history"]);
  });

  it("does not serve an incomplete set (no cov) or a set older than condemned", async () => {
    put(`${K}/names.1111111111111111.parquet`, 1 * D);
    expect(await serveExposureHistorySet(K, BUILD, ["cov"])).toBeNull();
    put(`${K}/cov.1111111111111111.parquet`, 1 * D);
    expect(await serveExposureHistorySet(K, BUILD, ["cov"])).not.toBeNull();
    put(`${K}/condemned`, 1 * H);
    expect(await serveExposureHistorySet(K, BUILD, ["cov"])).toBeNull();
  });

  it("on a condemned folder: one miss writes a new generation, then hits serve it", async () => {
    put(`${K}/names.parquet`, 9 * D);
    put(`${K}/cov.parquet`, 9 * D);
    put(`${K}/condemned`, 2 * H);
    expect(await serveExposureHistorySet(K, BUILD, ["cov"])).toBeNull();
    const fresh = await writeExposureHistorySet(K, BUILD, files());
    clock.t += 1000;
    expect(await serveExposureHistorySet(K, BUILD, ["cov"])).toEqual(fresh);
  });

  it("serves daily sets with many files and a legacy set", async () => {
    put(`${K}/names_2023.parquet`, 1 * D);
    put(`${K}/names_2024.parquet`, 1 * D);
    put(`${K}/cov.parquet`, 1 * D);
    const hit = await serveExposureHistorySet(K, BUILD, ["cov"]);
    expect(Object.keys(hit!).sort()).toEqual(["cov", "names_2023", "names_2024"]);
  });

  it("misses when a required file is absent from the newest set", async () => {
    put(`${K}/names_2023.parquet`, 1 * D);
    put(`${K}/cov.parquet`, 1 * D);
    expect(await serveExposureHistorySet(K, BUILD, ["names_2023", "names_2024", "cov"])).toBeNull();
  });

  it("still serves a hit when the marker write fails, without writing a new generation", async () => {
    put(`${K}/names.parquet`, 1 * D);
    put(`${K}/cov.parquet`, 1 * D);
    const orig = fakeBucket.upload;
    fakeBucket.upload = async (path, body, opts) => (path.includes("/hits/") ? { error: { message: "down" } } : orig(path, body, opts));
    const hit = await serveExposureHistorySet(K, BUILD, ["names", "cov"]);
    fakeBucket.upload = orig;
    expect(Object.keys(hit!).sort()).toEqual(["cov", "names"]);
    expect([...store.keys()].length).toBe(2);
  });

  it("refuses URLs longer than the cleanup is sized for", async () => {
    put(`${K}/names.parquet`, 1 * D);
    put(`${K}/cov.parquet`, 1 * D);
    await expect(serveExposureHistorySet(K, BUILD, ["cov"], 7200)).rejects.toThrow(/outlive/);
  });

  it("removes the files of a set whose write failed", async () => {
    const orig = fakeBucket.upload;
    fakeBucket.upload = async (path, body, opts) =>
      path.includes("/cov.") ? { error: { message: "boom" } } : orig(path, body, opts);
    await expect(writeExposureHistorySet(K, BUILD, files())).rejects.toThrow(/boom/);
    fakeBucket.upload = orig;
    expect([...store.keys()].filter((p) => p.endsWith(".parquet"))).toEqual([]);
  });

  it("fails closed when the listing does not finish", async () => {
    for (let i = 0; i < 20_001; i += 1) store.set(`${K}/z${String(i).padStart(5, "0")}`, { created_at: iso(), updated_at: iso(), body: "" });
    expect((await inspectExposureHistoryFolder(K)).error).toBe(true);
  });

  it("build tag trims", () => {
    expect(exposureHistoryBuildTag(" 2026-10-08T00:00:00Z ")).toBe(exposureHistoryBuildTag(BUILD));
    expect(exposureHistoryBuildTag(null)).toBe(exposureHistoryBuildTag("  "));
  });
});

describe("cleanup with the route rules", () => {
  it("a request during a multi-chunk delete gets no URL for a path being deleted, and its URLs survive", async () => {
    for (let i = 0; i < 600; i += 1) {
      const g = i.toString(16).padStart(16, "0");
      put(`${K}/cov.${g}.parquet`, 9 * D);
      put(`${K}/names.${g}.parquet`, 9 * D);
    }
    put(`${K}/condemned`, 1 * D);
    const served: string[] = [];
    let calls = 0;
    hooks.afterRemove = async () => {
      calls += 1;
      if (calls !== 1) return;
      // Paused after the first remove chunk: a request arrives.
      clock.t += 1000;
      let urls = await serveExposureHistorySet(K, BUILD, ["cov"]);
      if (!urls) urls = await writeExposureHistorySet(K, BUILD, files());
      served.push(...Object.values(urls));
    };
    const r = await cleanupExposureHistory(supabaseBucketApi(), { now: new Date(clock.t), currentBuiltUtc: BUILD });
    expect(r).toMatchObject({ deleted: 1, errors: [] });
    expect(served.length).toBe(2);
    for (const u of served) expect(exists(u)).toBe(true);
    expect(store.has(`${K}/condemned`)).toBe(false);
  });

  it("a hit just before condemnation keeps its files through the URL TTL", async () => {
    put(`${K}/names.1111111111111111.parquet`, 9 * D);
    put(`${K}/cov.1111111111111111.parquet`, 9 * D);
    // Hit now; cleanup runs 4 h later (no condemn), then 8 days later (condemn only).
    const urls = (await serveExposureHistorySet(K, BUILD, ["cov"]))!;
    clock.t += 4 * H;
    const r1 = await cleanupExposureHistory(supabaseBucketApi(), { now: new Date(clock.t), currentBuiltUtc: BUILD });
    expect(r1.condemned).toBe(0); // last activity is the hit marker, 4 h old: under the 7-day age
    clock.t += 8 * D;
    const r2 = await cleanupExposureHistory(supabaseBucketApi(), { now: new Date(clock.t), currentBuiltUtc: BUILD });
    expect(r2.condemned).toBe(1);
    expect(Object.values(urls).every(exists)).toBe(true);
  });

  it("a served set survives until a newer set has been complete for longer than the guard", async () => {
    put(`${K}/names.1111111111111111.parquet`, 5 * D);
    put(`${K}/cov.1111111111111111.parquet`, 5 * D);
    const g = (await serveExposureHistorySet(K, BUILD, ["names", "cov"]))!; // set G served at t0
    // H written just after, e.g. by a request that saw G as incomplete.
    clock.t += 1000;
    const h = await writeExposureHistorySet(K, BUILD, files());
    clock.t += 3600 * 1000 - 1000; // H.newest + TTL - 1 s
    await cleanupExposureHistory(supabaseBucketApi(), { now: new Date(clock.t), currentBuiltUtc: BUILD });
    expect(Object.values(g).every(exists)).toBe(true);
    clock.t += 2 * H + 2000; // past H.newest + guard
    await cleanupExposureHistory(supabaseBucketApi(), { now: new Date(clock.t), currentBuiltUtc: BUILD });
    expect(Object.values(g).some(exists)).toBe(false);
    expect(Object.values(h).every(exists)).toBe(true);
  });

  it("prunes superseded generations on a live folder but never the one being served", async () => {
    put(`${K}/names.1111111111111111.parquet`, 5 * D);
    put(`${K}/cov.1111111111111111.parquet`, 5 * D);
    put(`${K}/names.2222222222222222.parquet`, 4 * D);
    put(`${K}/cov.2222222222222222.parquet`, 4 * D);
    put(`${K}/names.3333333333333333.parquet`, 1 * H); // newest set, inside the guard
    put(`${K}/cov.3333333333333333.parquet`, 1 * H);
    const r = await cleanupExposureHistory(supabaseBucketApi(), { now: new Date(clock.t), currentBuiltUtc: BUILD });
    expect(r.errors).toEqual([]);
    const left = [...store.keys()].filter((p) => p.endsWith(".parquet")).sort();
    // gen 1 is superseded by gen 2 (complete for > guard); gen 2 stays because gen 3 is too new.
    expect(left).toEqual([
      `${K}/cov.2222222222222222.parquet`,
      `${K}/cov.3333333333333333.parquet`,
      `${K}/names.2222222222222222.parquet`,
      `${K}/names.3333333333333333.parquet`,
    ]);
  });
});
