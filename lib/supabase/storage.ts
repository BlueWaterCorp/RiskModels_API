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

import { createClient } from "./admin";

const BUCKET = "reports";
const PREFIX = "tickers";

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
  const supabase = createClient();
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
  const supabase = createClient();
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
  const supabase = createClient();
  const folder = `${PREFIX}/${ticker.toUpperCase()}`;

  const { data } = await supabase.storage
    .from(BUCKET)
    .list(folder, { sortBy: { column: "created_at", order: "desc" } });

  return (data ?? []).map((f) => ({
    name: f.name,
    created_at: f.created_at ?? "",
  }));
}
