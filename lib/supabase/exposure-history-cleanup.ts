/**
 * Daily cleanup of the private `exposure-history` Storage bucket
 * (docs/EXPOSURE_HISTORY_FEED.md, "Storage and cleanup").
 *
 * Folder layout (a 32-hex cache key): `{file}.{gen}.parquet` (one set per
 * upload, never overwritten; `cov` last marks it complete), hit markers
 * `hits/{build tag}.{10-min window}` (legacy `hit.{tag}` at the top level),
 * and, once cleanup has chosen the folder, `condemned`.
 *
 * Two phases, one per daily run:
 *   1. Condemn. A folder whose last activity (latest created/updated time of
 *      any object other than `condemned`) is older than the guard (URL TTL +
 *      margin), and either older than the max age or tagged only with other
 *      panel builds, gets a `condemned` marker.
 *   2. Delete. On a later run, a condemned folder whose marker is older than
 *      DELETE_AFTER_MS, with nothing newer than the marker, has the objects it
 *      listed removed; if something is newer, the marker is removed instead.
 *
 * The routes serve only a complete set written after any `condemned` marker
 * and write a hit marker before signing a URL. On kept folders, cleanup
 * prunes hit markers older than the guard (keeping the newest per build tag)
 * and superseded generations. Uploads always use new paths, so a delete of
 * listed paths cannot remove a file uploaded after the listing. Only this
 * bucket is touched, and only top-level folders whose name is a cache key.
 */

import { createAdminClient } from "./admin";
import {
  EXPOSURE_HISTORY_BUCKET,
  EXPOSURE_HISTORY_CONDEMNED,
  EXPOSURE_HISTORY_FILE_RE,
  EXPOSURE_HISTORY_URL_TTL_SECONDS,
  exposureHistoryBuildTag,
} from "./storage";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Max age when `EXPOSURE_HISTORY_MAX_AGE_DAYS` is unset or invalid. */
export const DEFAULT_MAX_AGE_DAYS = 7;
/** Smallest accepted max age, whatever the env var says. */
export const MIN_MAX_AGE_DAYS = 1;
/** Margin added to the URL TTL. */
export const SAFETY_MARGIN_MS = 2 * HOUR_MS;
/** A condemned folder is deleted only once its marker is at least this old. */
export const DELETE_AFTER_MS = 12 * HOUR_MS;
/** Longest a route request can run (Vercel maxDuration on both routes). */
const MAX_REQUEST_MS = 300 * 1000;
// URL safety rests on these orderings; fail at load if a constant is changed past them.
if (!(SAFETY_MARGIN_MS > MAX_REQUEST_MS && DELETE_AFTER_MS > EXPOSURE_HISTORY_URL_TTL_SECONDS * 1000 + SAFETY_MARGIN_MS)) {
  throw new Error("exposure-history cleanup: DELETE_AFTER_MS / SAFETY_MARGIN_MS too small for the URL TTL");
}
const CACHE_KEY_RE = /^[0-9a-f]{32}$/;
/** `hits/{tag}.{ms}` (current) or `hit.{tag}` (legacy, top level). */
const MARKER_RE = /^(?:hits\/|hit\.)([0-9a-f]{12})(?:\.|$)/;
const REMOVE_CHUNK = 500;
const PAGE = 100;
const MAX_PAGES = 1000;

export interface StorageEntry {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The subset of the Supabase bucket API the cleanup uses (injectable for tests). */
export interface BucketApi {
  list(
    prefix: string,
    opts: { limit: number; offset: number },
  ): Promise<{ data: StorageEntry[] | null; error: { message: string } | null }>;
  upload(path: string, body: Buffer): Promise<{ error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export interface CleanupOptions {
  now?: Date;
  maxAgeDays?: number;
  /** `built_utc` of the current panel; null/undefined disables the build rule. */
  currentBuiltUtc?: string | null;
  /** Stop scanning after this many ms (the route has 300 s). */
  budgetMs?: number;
  /** Index of the folder to start at (wraps). Default random, so runs cut short cover different folders. */
  startAt?: number;
  dryRun?: boolean;
}

export interface CleanupResult {
  bucket: string;
  folders: number;
  scanned: number;
  complete: boolean;
  condemned: number;
  deleted: number;
  deleted_objects: number;
  reprieved: number;
  kept: number;
  pruned_markers: number;
  reasons: { age: number; stale_build: number };
  guard_ms: number;
  max_age_days: number;
  build_rule: boolean;
  dry_run: boolean;
  errors: string[];
}

export function maxAgeDaysFromEnv(raw = process.env.EXPOSURE_HISTORY_MAX_AGE_DAYS): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_MAX_AGE_DAYS;
  return Math.max(MIN_MAX_AGE_DAYS, n);
}

export function guardMs(): number {
  return EXPOSURE_HISTORY_URL_TTL_SECONDS * 1000 + SAFETY_MARGIN_MS;
}

function ts(e: StorageEntry): number | null {
  const vals = [e.updated_at, e.created_at]
    .map((v) => (v ? Date.parse(v) : NaN))
    .filter((v) => Number.isFinite(v));
  return vals.length ? Math.max(...vals) : null;
}

export type Verdict =
  | { action: "keep"; reason: "active" | "young" | "no_timestamp" | "empty" | "condemned_recently" }
  | { action: "condemn"; reason: "age" | "stale_build" }
  | { action: "delete" }
  | { action: "reprieve" };

/** Decide one folder from its listing. Pure. */
export function judgeFolder(
  objects: StorageEntry[],
  nowMs: number,
  maxAgeDays: number,
  currentTag: string | null,
): Verdict {
  const files = objects.filter((o) => o.id); // sub-folders have id null
  const marker = files.find((f) => f.name === EXPOSURE_HISTORY_CONDEMNED);
  const others = files.filter((f) => f !== marker);
  if (files.length === 0) return { action: "keep", reason: "empty" };
  if (files.some((f) => ts(f) === null)) return { action: "keep", reason: "no_timestamp" };
  const last = others.length ? Math.max(...others.map((f) => ts(f) as number)) : -Infinity;

  if (marker) {
    const c = ts(marker) as number;
    if (last >= c) return { action: "reprieve" }; // activity since condemnation
    if (nowMs - c < DELETE_AFTER_MS) return { action: "keep", reason: "condemned_recently" };
    return { action: "delete" };
  }

  if (nowMs - last < guardMs()) return { action: "keep", reason: "active" };
  if (nowMs - last > Math.max(MIN_MAX_AGE_DAYS, maxAgeDays) * DAY_MS) return { action: "condemn", reason: "age" };
  if (currentTag) {
    const tags = others.map((f) => MARKER_RE.exec(f.name)?.[1]).filter(Boolean) as string[];
    if (tags.length > 0 && !tags.includes(currentTag)) return { action: "condemn", reason: "stale_build" };
  }
  return { action: "keep", reason: "young" };
}

class BudgetExceeded extends Error {}

async function listAll(api: BucketApi, prefix: string, deadline = Infinity): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  // Advance by rows received and stop on an empty page, so a server that
  // returns fewer rows than `limit` per page still gets read to the end.
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (Date.now() > deadline) throw new BudgetExceeded();
    const { data, error } = await api.list(prefix, { limit: PAGE, offset: out.length });
    if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return out;
    out.push(...rows);
  }
  throw new Error(`list ${prefix || "/"}: more than ${MAX_PAGES} pages`);
}

/**
 * Objects of one folder: top level plus `hits/` (names prefixed `hits/`).
 * `hits/` is always listed, whether or not the top level shows it.
 */
async function listFolder(api: BucketApi, key: string, deadline: number): Promise<StorageEntry[]> {
  const top = await listAll(api, key, deadline);
  const hits = (await listAll(api, `${key}/hits`, deadline)).filter((o) => o.id);
  return [...top, ...hits.map((h) => ({ ...h, name: `hits/${h.name}` }))];
}

/** Hit markers that can go: older than the guard and not the newest of their build tag. */
export function prunableHits(objects: StorageEntry[], nowMs: number): string[] {
  const hits = objects
    .filter((o) => o.id && o.name.startsWith("hits/"))
    .map((o) => ({ name: o.name, t: ts(o), tag: MARKER_RE.exec(o.name)?.[1] ?? o.name }));
  const newest = new Map<string, number>();
  for (const h of hits) if (h.t !== null) newest.set(h.tag, Math.max(newest.get(h.tag) ?? -Infinity, h.t));
  return hits
    .filter((h) => h.t !== null && nowMs - h.t > guardMs() && h.t < (newest.get(h.tag) as number))
    .map((h) => h.name);
}

export function supabaseBucketApi(): BucketApi {
  // Bound to the one bucket; there is no code path to any other.
  const bucket = createAdminClient().storage.from(EXPOSURE_HISTORY_BUCKET);
  return {
    list: (prefix, opts) =>
      bucket.list(prefix, { ...opts, sortBy: { column: "name", order: "asc" } }) as ReturnType<BucketApi["list"]>,
    upload: async (path, body) => {
      const { error } = await bucket.upload(path, body, { contentType: "text/plain", upsert: false });
      return { error };
    },
    remove: async (paths) => {
      const { error } = await bucket.remove(paths);
      return { error };
    },
  };
}

/**
 * Data files of superseded generations on a kept folder. A generation can go
 * when a newer complete set (has `cov`) has existed for longer than the guard:
 * since then every hit has served that newer set, so no valid URL points at
 * the older one. Incomplete generations (no `cov`, never served) go once all
 * their files are older than the guard. Gen "" (legacy names) is treated the
 * same way.
 */
export function prunableGenerations(objects: StorageEntry[], nowMs: number): string[] {
  const gens = new Map<string, { names: string[]; oldest: number; newest: number; complete: boolean; bad: boolean }>();
  for (const o of objects) {
    if (!o.id || o.name.includes("/")) continue;
    const m = EXPOSURE_HISTORY_FILE_RE.exec(o.name);
    if (!m) continue;
    const g = gens.get(m[2] ?? "") ?? { names: [], oldest: Infinity, newest: -Infinity, complete: false, bad: false };
    const t = ts(o);
    if (t === null) g.bad = true;
    else {
      g.oldest = Math.min(g.oldest, t);
      g.newest = Math.max(g.newest, t);
    }
    if (m[1] === "cov") g.complete = true;
    g.names.push(o.name);
    gens.set(m[2] ?? "", g);
  }
  const all = [...gens.values()].filter((g) => !g.bad);
  const out: string[] = [];
  for (const g of all) {
    if (nowMs - g.newest <= guardMs()) continue;
    const superseded = all.some((h) => h !== g && h.complete && h.oldest > g.newest && nowMs - h.newest > guardMs());
    if (superseded || !g.complete) out.push(...g.names);
  }
  return out;
}

export async function cleanupExposureHistory(
  api: BucketApi,
  opts: CleanupOptions = {},
): Promise<CleanupResult> {
  const started = Date.now();
  const nowMs = (opts.now ?? new Date()).getTime();
  const maxAgeDays = Math.max(MIN_MAX_AGE_DAYS, opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS);
  const currentTag = opts.currentBuiltUtc ? exposureHistoryBuildTag(opts.currentBuiltUtc) : null;
  const budgetMs = opts.budgetMs ?? 240_000;
  const result: CleanupResult = {
    bucket: EXPOSURE_HISTORY_BUCKET,
    folders: 0,
    scanned: 0,
    complete: true,
    condemned: 0,
    deleted: 0,
    deleted_objects: 0,
    reprieved: 0,
    kept: 0,
    pruned_markers: 0,
    reasons: { age: 0, stale_build: 0 },
    guard_ms: guardMs(),
    max_age_days: maxAgeDays,
    build_rule: currentTag !== null,
    dry_run: Boolean(opts.dryRun),
    errors: [],
  };

  const deadline = started + budgetMs;
  // Top-level entries without an id are folders; only cache-key folders are considered.
  let root: StorageEntry[];
  try {
    root = await listAll(api, "", deadline);
  } catch (e) {
    if (e instanceof BudgetExceeded) return { ...result, complete: false };
    throw e;
  }
  const folders = root.filter((e) => !e.id && CACHE_KEY_RE.test(e.name)).map((e) => e.name);
  result.folders = folders.length;
  const startAt = opts.startAt ?? Math.floor(Math.random() * Math.max(1, folders.length));
  const start = folders.length ? ((startAt % folders.length) + folders.length) % folders.length : 0;

  for (let i = 0; i < folders.length; i += 1) {
    if (Date.now() > deadline) {
      result.complete = false;
      break;
    }
    const key = folders[(start + i) % folders.length];
    result.scanned += 1;
    try {
      const objects = await listFolder(api, key, deadline);
      const v = judgeFolder(objects, nowMs, maxAgeDays, currentTag);
      if (v.action === "keep") {
        result.kept += 1;
        if (v.reason === "active" || v.reason === "young") {
          const prune = [...prunableHits(objects, nowMs), ...prunableGenerations(objects, nowMs)].map((n) => `${key}/${n}`);
          for (let j = 0; j < prune.length && !opts.dryRun; j += REMOVE_CHUNK) {
            const { error } = await api.remove(prune.slice(j, j + REMOVE_CHUNK));
            if (error) throw new Error(`prune ${key}: ${error.message}`);
          }
          result.pruned_markers += prune.length;
        }
      } else if (v.action === "condemn") {
        if (!opts.dryRun) {
          const { error } = await api.upload(`${key}/${EXPOSURE_HISTORY_CONDEMNED}`, Buffer.from(new Date(nowMs).toISOString()));
          if (error) throw new Error(`condemn ${key}: ${error.message}`);
        }
        result.condemned += 1;
        result.reasons[v.reason] += 1;
      } else if (v.action === "reprieve") {
        if (!opts.dryRun) {
          const { error } = await api.remove([`${key}/${EXPOSURE_HISTORY_CONDEMNED}`]);
          if (error) throw new Error(`reprieve ${key}: ${error.message}`);
        }
        result.reprieved += 1;
      } else {
        // Only the paths listed above (uploads never reuse a path, so a file
        // written after the listing survives), and `condemned` last: while any
        // listed file remains, the marker stays and the route serves only
        // sets newer than it, which are not in this list.
        const marker = `${key}/${EXPOSURE_HISTORY_CONDEMNED}`;
        const data = objects.filter((o) => o.id).map((o) => `${key}/${o.name}`).filter((p) => p !== marker);
        const paths = [...data, marker];
        if (!opts.dryRun) {
          for (let j = 0; j < data.length; j += REMOVE_CHUNK) {
            const { error } = await api.remove(data.slice(j, j + REMOVE_CHUNK));
            if (error) throw new Error(`remove ${key}: ${error.message}`);
          }
          const { error } = await api.remove([marker]);
          if (error) throw new Error(`remove ${key}: ${error.message}`);
        }
        result.deleted += 1;
        result.deleted_objects += paths.length;
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        result.scanned -= 1;
        result.complete = false;
        break;
      }
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
