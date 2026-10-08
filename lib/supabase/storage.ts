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

import { createHash } from "crypto";
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

/**
 * Short tag for a panel build, used in the hit-marker object name
 * (`{cache key}/hit.{tag}`) so cleanup can tell the build from a folder
 * listing without downloading anything.
 */
export function exposureHistoryBuildTag(builtUtc: unknown): string {
  const v = typeof builtUtc === "string" && builtUtc.trim() ? builtUtc : "none";
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
 * Signed URL for an exposure-history feed file, or null if it does not exist.
 * The cache key covers the request and the panel build, so a hit is the same
 * content and is safe to reuse.
 */
export async function signExposureHistoryFile(
  cacheKey: string,
  name: "names" | "cov",
  expiresIn = 3600,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(EXPOSURE_HISTORY_BUCKET)
    .createSignedUrl(`${cacheKey}/${name}.parquet`, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Record a request for `cacheKey` by upserting the tiny marker
 * `{cache key}/hit.{build tag}`. Its `updated_at` is the folder's last
 * activity, which cleanup uses so that a cache hit is never deleted while
 * its signed URL is valid. Returns false if the write failed.
 */
export async function touchExposureHistoryFolder(
  cacheKey: string,
  builtUtc: unknown,
): Promise<boolean> {
  const supabase = createAdminClient();
  const path = `${cacheKey}/hit.${exposureHistoryBuildTag(builtUtc)}`;
  const { error } = await supabase.storage
    .from(EXPOSURE_HISTORY_BUCKET)
    .upload(path, Buffer.from(new Date().toISOString()), {
      contentType: "text/plain",
      upsert: true,
    });
  if (error) {
    console.warn(`[exposure-history] touch ${path} failed: ${error.message}`);
    return false;
  }
  return true;
}

/** Upload an exposure-history feed file (Parquet) and return its signed URL. */
export async function uploadExposureHistoryFile(
  cacheKey: string,
  name: "names" | "cov",
  bytes: Buffer,
  expiresIn = 3600,
): Promise<string> {
  const supabase = createAdminClient();
  const path = `${cacheKey}/${name}.parquet`;
  const { error } = await supabase.storage.from(EXPOSURE_HISTORY_BUCKET).upload(path, bytes, {
    contentType: "application/vnd.apache.parquet",
    upsert: true,
  });
  if (error) throw new Error(`Failed to upload ${path}: ${error.message}`);
  const url = await signExposureHistoryFile(cacheKey, name, expiresIn);
  if (!url) throw new Error(`Failed to sign ${path}`);
  return url;
}
