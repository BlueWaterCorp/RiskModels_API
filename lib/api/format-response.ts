/**
 * Format Response Utility (Option A: Runtime Parquet/CSV)
 *
 * Converts tabular data to JSON, Parquet, or CSV. Used by time-series endpoints
 * with ?format=json|parquet|csv. No GCS dependency — builds Parquet in-memory.
 */

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
const parquet = require("parquetjs-lite"); // eslint-disable-line

export type ResponseFormat = "json" | "parquet" | "csv";

/** Infer Parquet schema from first row of data */
function inferParquetSchema(
  sample: Record<string, unknown>,
): Record<string, { type: string; optional?: boolean }> {
  const schema: Record<string, { type: string; optional?: boolean }> = {};
  for (const [key, value] of Object.entries(sample)) {
    if (value === null || value === undefined) {
      schema[key] = { type: "UTF8", optional: true };
    } else if (typeof value === "string") {
      schema[key] = { type: "UTF8", optional: true };
    } else if (typeof value === "number") {
      schema[key] = {
        type: Number.isInteger(value) ? "INT64" : "DOUBLE",
        optional: true,
      };
    } else if (typeof value === "boolean") {
      schema[key] = { type: "BOOLEAN", optional: true };
    } else if (value instanceof Date) {
      schema[key] = { type: "TIMESTAMP_MILLIS", optional: true };
    } else {
      schema[key] = { type: "UTF8", optional: true };
    }
  }
  return schema;
}

/** Escape CSV value */
function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Convert rows to CSV string */
function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => escapeCsv(row[h])).join(","),
    ),
  ];
  return lines.join("\n");
}

/** Write Parquet to buffer using temp file (parquetjs-lite requires file or stream) */
async function rowsToParquetBuffer(
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  if (rows.length === 0) {
    const emptySchema = new parquet.ParquetSchema({ _placeholder: { type: "UTF8", optional: true } });
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `parquet-empty-${randomUUID()}.parquet`);
    try {
      const writer = await parquet.ParquetWriter.openFile(emptySchema, tmpPath);
      await writer.close();
      return fs.readFileSync(tmpPath);
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }

  const sample = rows[0] as Record<string, unknown>;
  const schemaDef = inferParquetSchema(sample);
  const parquetSchema = new parquet.ParquetSchema(schemaDef);

  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `parquet-${randomUUID()}.parquet`);

  try {
    const writer = await parquet.ParquetWriter.openFile(parquetSchema, tmpPath);

    for (const row of rows) {
      const cleanRow: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        cleanRow[k] = v === null || v === undefined ? null : v;
      }
      await writer.appendRow(cleanRow);
    }
    await writer.close();

    const buffer = fs.readFileSync(tmpPath);
    return buffer;
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

export interface FormatResponseOptions {
  rows: Record<string, unknown>[];
  format: ResponseFormat;
  filename: string;
  extraHeaders?: Record<string, string>;
  /** For JSON: include metadata in body. Omit for parquet/csv (binary/text). */
  jsonPayload?: Record<string, unknown>;
}

/**
 * Return a Response with data in the requested format.
 * For parquet/csv, only the tabular rows are returned (no _metadata wrapper).
 */
export async function formatResponse(
  options: FormatResponseOptions,
): Promise<NextResponse> {
  const { rows, format, filename, extraHeaders = {}, jsonPayload } = options;

  const disposition = `attachment; filename="${filename}"`;

  const headers: Record<string, string> = {
    "Content-Disposition": disposition,
    ...extraHeaders,
  };

  if (format === "json") {
    const body = jsonPayload ?? { data: rows };
    return new NextResponse(JSON.stringify(body), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
    });
  }

  if (format === "csv") {
    const csv = rowsToCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  if (format === "parquet") {
    const buffer = await rowsToParquetBuffer(rows);
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/vnd.apache.parquet",
      },
    });
  }

  throw new Error(`Unknown format: ${format}`);
}

// ---------------------------------------------------------------------------
// Flatten helpers — convert nested JSON structures to flat rows for CSV
// ---------------------------------------------------------------------------

/** Strip internal keys and flatten a nested object to one flat row. */
export function flattenObjectToRow(
  obj: Record<string, unknown>,
  stripKeys: string[] = ["_metadata", "_agent", "_data_health"],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (stripKeys.includes(key)) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      // Spread nested object flat (e.g. metrics: { vol_23d: 0.3 } → vol_23d: 0.3)
      for (const [innerKey, innerVal] of Object.entries(
        value as Record<string, unknown>,
      )) {
        row[innerKey] = innerVal;
      }
    } else {
      row[key] = value;
    }
  }
  return row;
}

/** Convert a dict-of-objects into an array of flat rows keyed by `keyColumn`. */
export function dictToRows(
  dict: Record<string, unknown>,
  keyColumn: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(dict)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      rows.push({ [keyColumn]: key, ...(value as Record<string, unknown>) });
    } else {
      rows.push({ [keyColumn]: key, value });
    }
  }
  return rows;
}

/** Parse format from query string or Accept header. Default: json */
export function parseFormat(
  searchParams: URLSearchParams,
  acceptHeader?: string | null,
): ResponseFormat {
  const q = searchParams.get("format")?.toLowerCase();
  if (q === "parquet" || q === "csv") return q;
  if (!q || q === "json") return "json";
  if (acceptHeader?.includes("application/vnd.apache.parquet")) return "parquet";
  if (acceptHeader?.includes("text/csv")) return "csv";
  return "json";
}
