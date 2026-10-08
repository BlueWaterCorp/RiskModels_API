/**
 * Daily cleanup of the private `exposure-history` Storage bucket
 * (docs/EXPOSURE_HISTORY_FEED.md, "Storage and cleanup").
 *
 * Layout: `{cache key}/names.parquet`, `{cache key}/cov.parquet` and the hit
 * marker `{cache key}/hit.{build tag}`, which the route upserts on every
 * request. A folder's last activity is the latest created/updated time of
 * any object in it.
 *
 * A folder is deleted when its last activity is older than the guard
 * (URL TTL + safety margin) AND either
 *   - its last activity is older than the max age (default 7 days), or
 *   - its hit marker names a panel build other than the current one.
 * Folders without a marker (written before markers existed) fall under the
 * age rule only. Only this bucket is touched, only top-level folders whose
 * name is a cache key, and each folder is re-listed right before deletion.
 */

import { createAdminClient } from "./admin";
import {
  EXPOSURE_HISTORY_BUCKET,
  EXPOSURE_HISTORY_URL_TTL_SECONDS,
  exposureHistoryBuildTag,
} from "./storage";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Max age when `EXPOSURE_HISTORY_MAX_AGE_DAYS` is unset or invalid. */
export const DEFAULT_MAX_AGE_DAYS = 7;
/** Smallest accepted max age, whatever the env var says. */
export const MIN_MAX_AGE_DAYS = 1;
/** Margin added to the URL TTL; no folder active within TTL + margin is deleted. */
export const SAFETY_MARGIN_MS = 2 * HOUR_MS;
const CACHE_KEY_RE = /^[0-9a-f]{32}$/;
const MARKER_RE = /^hit\.([0-9a-f]{12})$/;
const PAGE = 1000;

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
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export interface CleanupOptions {
  now?: Date;
  maxAgeDays?: number;
  /** `built_utc` of the current panel; null/undefined disables the build rule. */
  currentBuiltUtc?: string | null;
  /** Upper bound on folders deleted in one run. */
  maxFolders?: number;
  dryRun?: boolean;
}

export interface CleanupResult {
  bucket: string;
  scanned: number;
  deleted: number;
  deleted_objects: number;
  kept: number;
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
  | { delete: false; reason: "active" | "no_timestamp" | "empty" | "young" }
  | { delete: true; reason: "age" | "stale_build" };

/** Decide one folder from its listing. Pure. */
export function judgeFolder(
  objects: StorageEntry[],
  nowMs: number,
  maxAgeDays: number,
  currentTag: string | null,
): Verdict {
  const files = objects.filter((o) => o.id); // folders have id null
  if (files.length === 0) return { delete: false, reason: "empty" };
  const times = files.map(ts);
  // Any object without a timestamp: cannot prove inactivity, keep.
  if (times.some((t) => t === null)) return { delete: false, reason: "no_timestamp" };
  const last = Math.max(...(times as number[]));
  const idle = nowMs - last;
  if (idle < guardMs()) return { delete: false, reason: "active" };
  if (idle > Math.max(MIN_MAX_AGE_DAYS, maxAgeDays) * DAY_MS) return { delete: true, reason: "age" };
  if (currentTag) {
    const tags = files.map((f) => MARKER_RE.exec(f.name)?.[1]).filter(Boolean) as string[];
    if (tags.length > 0 && !tags.includes(currentTag)) return { delete: true, reason: "stale_build" };
  }
  return { delete: false, reason: "young" };
}

async function listAll(api: BucketApi, prefix: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await api.list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export function supabaseBucketApi(): BucketApi {
  // Bound to the one bucket; there is no code path to any other.
  const bucket = createAdminClient().storage.from(EXPOSURE_HISTORY_BUCKET);
  return {
    list: (prefix, opts) =>
      bucket.list(prefix, { ...opts, sortBy: { column: "name", order: "asc" } }) as ReturnType<BucketApi["list"]>,
    remove: async (paths) => {
      const { error } = await bucket.remove(paths);
      return { error };
    },
  };
}

export async function cleanupExposureHistory(
  api: BucketApi,
  opts: CleanupOptions = {},
): Promise<CleanupResult> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const maxAgeDays = Math.max(MIN_MAX_AGE_DAYS, opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS);
  const currentTag = opts.currentBuiltUtc ? exposureHistoryBuildTag(opts.currentBuiltUtc) : null;
  const maxFolders = opts.maxFolders ?? 5000;
  const result: CleanupResult = {
    bucket: EXPOSURE_HISTORY_BUCKET,
    scanned: 0,
    deleted: 0,
    deleted_objects: 0,
    kept: 0,
    reasons: { age: 0, stale_build: 0 },
    guard_ms: guardMs(),
    max_age_days: maxAgeDays,
    build_rule: currentTag !== null,
    dry_run: Boolean(opts.dryRun),
    errors: [],
  };

  // Top-level entries without an id are folders; only cache-key folders are considered.
  const folders = (await listAll(api, ""))
    .filter((e) => !e.id && CACHE_KEY_RE.test(e.name))
    .map((e) => e.name);

  for (const key of folders) {
    if (result.deleted >= maxFolders) break;
    result.scanned += 1;
    try {
      const first = judgeFolder(await listAll(api, key), nowMs, maxAgeDays, currentTag);
      if (!first.delete) {
        result.kept += 1;
        continue;
      }
      // Re-list right before deleting: a request in between rewrites the
      // marker, and the folder is then kept.
      const objects = await listAll(api, key);
      const v = judgeFolder(objects, nowMs, maxAgeDays, currentTag);
      if (!v.delete) {
        result.kept += 1;
        continue;
      }
      const paths = objects.filter((o) => o.id).map((o) => `${key}/${o.name}`);
      if (!opts.dryRun) {
        const { error } = await api.remove(paths);
        if (error) throw new Error(`remove ${key}: ${error.message}`);
      }
      result.deleted += 1;
      result.deleted_objects += paths.length;
      result.reasons[v.reason] += 1;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
