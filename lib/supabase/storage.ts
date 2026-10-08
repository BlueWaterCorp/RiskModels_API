/**
 * Supabase Storage utilities for snapshot PDF management.
 *
 * Bucket: "reports"
 * Path convention: reports/tickers/{SYMBOL}/{DATE}_deepdive.pdf
 *
 * Usage:
 *   import { uploadSnapshotPdf, getLatestSnapshotUrl } from "@/lib/supabase/storage";
 *   await uploadSnapshotPdf("NVDA", "2026-04-06", pdfBytes);
 *   const url = await getLatestSnapshotUrl("NVDA");
 */

import { createHash, randomUUID } from "crypto";
import { createAdminClient } from "./admin";

const BUCKET = "reports";
const PREFIX = "tickers";
/**
 * Exposure history feed files: private bucket `exposure-history`, paths
 * `{cache key}/{name}.parquet`, served only via signed URLs. Not `reports`:
 * that bucket is public and accepts only PDF/PNG (BWMACRO migration
 * 20261008220000_exposure_history_bucket).
 */
export const EXPOSURE_HISTORY_BUCKET = "exposure-history";

/** Lifetime of signed exposure-history URLs (seconds). Cleanup keeps a margin above it. */
export const EXPOSURE_HISTORY_URL_TTL_SECONDS = 3600;

/** Name of the marker the daily cleanup writes before deleting a folder on a later run. */
export const EXPOSURE_HISTORY_CONDEMNED = "condemned";

/**
 * Short tag for a panel build, used in hit-marker names
 * (`{folder}/hit.{tag}.{ms}`) so cleanup can tell the build from a folder
 * listing without downloading anything.
 */
export function exposureHistoryBuildTag(builtUtc: unknown): string {
  const v = typeof builtUtc === "string" && builtUtc.trim() ? builtUtc.trim() : "none";
  return createHash("sha256").update(v).digest("hex").slice(0, 12);
}

/**
 * Upload a snapshot PDF to Supabase Storage.
 *
 * @param ticker - Stock ticker (e.g., "NVDA")
 * @param date - ISO date string (e.g., "2026-04-06")
 * @param pdfBytes - Raw PDF content as Uint8Array or Buffer
 * @param reportType - Report type suffix (default: "deepdive")
 * @returns The storage path of the uploaded file
 */
export async function uploadSnapshotPdf(
  ticker: string,
  date: string,
  pdfBytes: Uint8Array | Buffer,
  reportType = "deepdive"
): Promise<string> {
  const supabase = createAdminClient();
  const path = `${PREFIX}/${ticker.toUpperCase()}/${date}_${reportType}.pdf`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload PDF to ${path}: ${error.message}`);
  }

  return path;
}

/**
 * Get a signed URL for the most recent snapshot PDF.
 *
 * @param ticker - Stock ticker
 * @param reportType - Filter by report type (optional)
 * @param expiresIn - URL expiry in seconds (default: 3600)
 * @returns Signed URL or null if no files found
 */
export async function getLatestSnapshotUrl(
  ticker: string,
  reportType?: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createAdminClient();
  const folder = `${PREFIX}/${ticker.toUpperCase()}`;

  const { data: files } = await supabase.storage
    .from(BUCKET)
    .list(folder, {
      sortBy: { column: "created_at", order: "desc" },
      limit: 10,
    });

  if (!files || files.length === 0) return null;

  // Filter by report type if specified
  const target = reportType
    ? files.find((f) => f.name.includes(reportType))
    : files[0];

  if (!target) return null;

  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(`${folder}/${target.name}`, expiresIn);

  return data?.signedUrl ?? null;
}

/**
 * List all snapshot PDFs for a ticker.
 */
export async function listSnapshots(
  ticker: string
): Promise<{ name: string; created_at: string }[]> {
  const supabase = createAdminClient();
  const folder = `${PREFIX}/${ticker.toUpperCase()}`;

  const { data } = await supabase.storage
    .from(BUCKET)
    .list(folder, { sortBy: { column: "created_at", order: "desc" } });

  return (data ?? []).map((f) => ({
    name: f.name,
    created_at: f.created_at ?? "",
  }));
}

/**
 * Exposure-history folder layout (docs/EXPOSURE_HISTORY_FEED.md, "Storage and cleanup"):
 *
 *   {cache key}/{file}.{gen}.parquet      one set per upload, never overwritten;
 *                                         `cov` is written last and marks the set complete
 *   {cache key}/hits/{build tag}.{window} one marker per 10-minute window with requests
 *   {cache key}/condemned                 written by cleanup
 *
 * `{file}` is `names`, `names_{year}` (daily feed) or `cov`. Every upload uses
 * a new `gen`, so no upload reuses a path that a cleanup delete (which
 * removes only the paths it listed) could still target. Folders written
 * before generations existed hold `{file}.parquet` (gen "") and `hit.{tag}`.
 */
export const EXPOSURE_HISTORY_FILE_RE = /^([a-z0-9_]+?)(?:\.([0-9a-f]{8,32}))?\.parquet$/;

/** Generation id for a new upload. */
export function newExposureHistoryGen(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export interface ExposureHistoryFolderState {
  /** Listing failed or was incomplete; do not serve from this folder. */
  error: boolean;
  /** Cleanup has marked the folder for deletion. */
  condemned: boolean;
  /**
   * The newest complete set (has `cov`) whose files were all written after
   * `condemned`, if any: file name (without gen) -> object path. A delete run
   * removes only paths it listed, and a listing that includes files newer
   * than the marker reprieves the folder.
   */
  set: Record<string, string> | null;
}

const INSPECT_PAGE = 1000;
const INSPECT_MAX_PAGES = 20;

function entryTime(o: { created_at?: string | null; updated_at?: string | null }): number | null {
  const v = [o.created_at, o.updated_at].map((x) => (x ? Date.parse(x) : NaN)).filter((x) => Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

/**
 * List `{cache key}/` (all pages, name order). Markers live in `hits/`, so the
 * top level holds only data files, `condemned` and the `hits` sub-folder.
 */
export async function inspectExposureHistoryFolder(cacheKey: string): Promise<ExposureHistoryFolderState> {
  const fail = { error: true, condemned: false, set: null };
  const supabase = createAdminClient();
  const bucket = supabase.storage.from(EXPOSURE_HISTORY_BUCKET);
  const rows: Array<{ name: string; id: string | null; created_at?: string | null; updated_at?: string | null }> = [];
  let done = false;
  for (let page = 0; page < INSPECT_MAX_PAGES; page += 1) {
    const { data, error } = await bucket.list(cacheKey, {
      limit: INSPECT_PAGE,
      offset: rows.length,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) return fail;
    if (!data || data.length === 0) {
      done = true;
      break;
    }
    rows.push(...data);
  }
  if (!done) return fail; // fail closed on a listing we could not finish
  const files = rows.filter((o) => o.id);
  const marker = files.find((f) => f.name === EXPOSURE_HISTORY_CONDEMNED);
  const condemnedAt = marker ? entryTime(marker) : null;
  if (marker && condemnedAt === null) return { error: false, condemned: true, set: null };
  const gens = new Map<string, { files: Record<string, string>; at: number; bad: boolean }>();
  for (const f of files) {
    const m = EXPOSURE_HISTORY_FILE_RE.exec(f.name);
    if (!m) continue;
    const g = gens.get(m[2] ?? "") ?? { files: {}, at: Infinity, bad: false };
    const t = entryTime(f);
    if (t === null) g.bad = true;
    else g.at = Math.min(g.at, t); // a set is as old as its oldest file
    g.files[m[1]] = `${cacheKey}/${f.name}`;
    gens.set(m[2] ?? "", g);
  }
  const complete = [...gens.values()]
    .filter((g) => !g.bad && g.files.cov)
    .filter((g) => condemnedAt === null || g.at > condemnedAt)
    .sort((x, y) => y.at - x.at);
  return { error: false, condemned: Boolean(marker), set: complete[0]?.files ?? null };
}

/** Signed URL for an object in the exposure-history bucket, or null. */
export async function signExposureHistoryPath(path: string, expiresIn = EXPOSURE_HISTORY_URL_TTL_SECONDS): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(EXPOSURE_HISTORY_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Hit markers are per 10-minute window, so a folder holds a bounded number of them. */
export const EXPOSURE_HISTORY_HIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Record a request on `folder` by upserting `{folder}/hits/{build tag}.{window}`.
 * The first request in a window creates the object, so its `created_at` is at
 * most one window old whether or not an upsert refreshes `updated_at`;
 * cleanup's margin covers the window. Returns false on failure.
 */
export async function touchExposureHistoryFolder(folder: string, builtUtc: unknown): Promise<boolean> {
  const supabase = createAdminClient();
  const now = Date.now();
  const path = `${folder}/hits/${exposureHistoryBuildTag(builtUtc)}.${Math.floor(now / EXPOSURE_HISTORY_HIT_WINDOW_MS)}`;
  const { error } = await supabase.storage
    .from(EXPOSURE_HISTORY_BUCKET)
    .upload(path, Buffer.from(new Date(now).toISOString()), { contentType: "text/plain", upsert: true });
  if (error) {
    console.warn(`[exposure-history] touch ${path} failed: ${error.message}`);
    return false;
  }
  return true;
}

/** Remove objects this request wrote and never signed (a half-written generation). */
export async function removeExposureHistoryPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(EXPOSURE_HISTORY_BUCKET).remove(paths);
  if (error) console.warn(`[exposure-history] cleanup of ${paths.join(",")} failed: ${error.message}`);
}

/**
 * Upload `{folder}/{name}.{gen}.parquet` (a new path; never overwrites) and
 * return its signed URL. Callers upload `cov` last: it marks the set complete.
 */
export async function uploadExposureHistoryFile(
  folder: string,
  name: string,
  gen: string,
  bytes: Buffer,
  expiresIn = EXPOSURE_HISTORY_URL_TTL_SECONDS,
): Promise<string> {
  const supabase = createAdminClient();
  const path = `${folder}/${name}.${gen}.parquet`;
  const { error } = await supabase.storage.from(EXPOSURE_HISTORY_BUCKET).upload(path, bytes, {
    contentType: "application/vnd.apache.parquet",
    upsert: false,
  });
  if (error) throw new Error(`Failed to upload ${path}: ${error.message}`);
  const url = await signExposureHistoryPath(path, expiresIn);
  if (!url) throw new Error(`Failed to sign ${path}`);
  return url;
}

/**
 * Signed URLs for a cached set under `cacheKey`, or null on a miss. Serves only
 * a complete set written after any `condemned` marker, and only after the hit
 * marker is written, so the daily cleanup sees the activity.
 */
export async function serveExposureHistorySet(
  cacheKey: string,
  builtUtc: unknown,
  expiresIn = EXPOSURE_HISTORY_URL_TTL_SECONDS,
): Promise<Record<string, string> | null> {
  const state = await inspectExposureHistoryFolder(cacheKey);
  if (state.error || !state.set) return null;
  if (!(await touchExposureHistoryFolder(cacheKey, builtUtc))) return null;
  const urls: Record<string, string> = {};
  for (const [name, path] of Object.entries(state.set)) {
    const url = await signExposureHistoryPath(path, expiresIn);
    if (!url) return null;
    urls[name] = url;
  }
  return urls;
}

/**
 * Write a new generation under `cacheKey`: every file except `cov` first, then
 * `cov` (which marks the set complete). On any failure the files written are
 * removed and the error is rethrown; no URL is returned. Returns name -> URL.
 */
export async function writeExposureHistorySet(
  cacheKey: string,
  builtUtc: unknown,
  files: Array<{ name: string; bytes: Buffer }>,
  expiresIn = EXPOSURE_HISTORY_URL_TTL_SECONDS,
): Promise<Record<string, string>> {
  const cov = files.find((f) => f.name === "cov");
  if (!cov) throw new Error("exposure-history set needs a cov file");
  const gen = newExposureHistoryGen();
  const rest = files.filter((f) => f !== cov);
  const pathOf = (name: string) => `${cacheKey}/${name}.${gen}.parquet`;
  try {
    const urls: Record<string, string> = {};
    const up = await Promise.all(rest.map((f) => uploadExposureHistoryFile(cacheKey, f.name, gen, f.bytes, expiresIn)));
    rest.forEach((f, i) => (urls[f.name] = up[i]));
    urls.cov = await uploadExposureHistoryFile(cacheKey, "cov", gen, cov.bytes, expiresIn);
    // Build tag for the stale-build rule; the new files' own timestamps are the activity.
    await touchExposureHistoryFolder(cacheKey, builtUtc);
    return urls;
  } catch (e) {
    await removeExposureHistoryPaths(files.map((f) => pathOf(f.name)));
    throw e;
  }
}
