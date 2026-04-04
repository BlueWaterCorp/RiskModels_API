/**
 * Chat tool result sanitization — keeps OpenAI context bounded.
 */

const DEFAULT_MAX_ROWS = 50;
const DEFAULT_TAIL_ROWS = 10;
const MAX_JSON_BYTES = 32_000;

export interface SanitizeRowsOptions {
  maxRows?: number;
  tailRows?: number;
  includeSummary?: boolean;
  /** Numeric keys to summarize when includeSummary */
  valueKeys?: string[];
}

function safeJsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Infinity;
  }
}

function numericSummary(rows: Record<string, unknown>[], keys: string[]) {
  const out: Record<string, { min: number; max: number; mean: number; count: number }> = {};
  for (const key of keys) {
    const nums = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length === 0) continue;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    out[key] = { min, max, mean, count: nums.length };
  }
  return out;
}

/**
 * Truncate an array of row objects: first maxRows + last tailRows + optional summary.
 */
export function truncateRowsWithSummary(
  rows: Record<string, unknown>[],
  options: SanitizeRowsOptions = {},
): unknown {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const tailRows = options.tailRows ?? DEFAULT_TAIL_ROWS;
  const includeSummary = options.includeSummary ?? true;
  const valueKeys =
    options.valueKeys ??
    ["returns_gross", "price_close", "l3_mkt_hr", "l3_sec_hr", "l3_sub_hr"];

  if (rows.length <= maxRows + tailRows) {
    return includeSummary && rows.length > 0
      ? {
          rows,
          row_count: rows.length,
          summary: numericSummary(rows, valueKeys),
        }
      : { rows, row_count: rows.length };
  }

  const head = rows.slice(0, maxRows);
  const tail = rows.slice(-tailRows);
  return {
    rows_head: head,
    rows_tail: tail,
    row_count: rows.length,
    truncated: true,
    summary: includeSummary ? numericSummary(rows, valueKeys) : undefined,
  };
}

/** Macro factor series: rows often have factor_key, teo, return or similar */
export function sanitizeMacroFactorSeries(
  rows: Record<string, unknown>[],
  options?: SanitizeRowsOptions,
): unknown {
  const valueKeys = options?.valueKeys ?? ["return", "total_return", "value"];
  return truncateRowsWithSummary(rows, { ...options, valueKeys });
}

export function sanitizePortfolioRiskIndexResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  const ts = r.time_series;
  if (!Array.isArray(ts) || ts.length <= 40) return result;

  const arr = ts as Record<string, unknown>[];
  return {
    ...r,
    time_series: {
      head: arr.slice(0, 20),
      tail: arr.slice(-20),
      point_count: arr.length,
      truncated: true,
    },
  };
}

/**
 * If stringified payload exceeds MAX_JSON_BYTES, keep top-level keys only and shallow values.
 */
export function applyLargeResultFallback(result: unknown): unknown {
  if (safeJsonSize(result) <= MAX_JSON_BYTES) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const o = result as Record<string, unknown>;
    const slim: Record<string, unknown> = { _truncated: true, original_size_bytes: safeJsonSize(result) };
    for (const k of Object.keys(o).slice(0, 12)) {
      const v = o[k];
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        slim[k] = v;
      } else if (Array.isArray(v)) {
        slim[k] = { type: "array", length: v.length };
      } else {
        slim[k] = typeof v;
      }
    }
    return slim;
  }
  return {
    _truncated: true,
    original_size_bytes: safeJsonSize(result),
    preview: String(result).slice(0, 500),
  };
}
