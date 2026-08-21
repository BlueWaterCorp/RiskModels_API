/**
 * OpenBB widget requests arrive as GET query params (tables/charts) or as
 * POST JSON (multi_file_viewer: the fileSelector list is in the body).
 * Merge both into URLSearchParams so widget routes can share one handler.
 */
import { NextRequest } from "next/server";

export async function readWidgetInput(
  req: NextRequest,
): Promise<URLSearchParams> {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
    return params;
  }
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return params;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return params;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      params.delete(key);
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

/** fileSelector may be a single string, repeated query keys, or a JSON array. */
export function selectedNames(
  params: URLSearchParams,
  key: string,
  fallback: string,
): string[] {
  const raw = params
    .getAll(key)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length > 0 ? raw : [fallback];
}

/** File-viewer cache key that changes when the grouped ticker changes. */
export function tickerScopedFileValue(ticker: string, stem: string): string {
  const t = ticker.trim().toUpperCase() || "AAPL";
  return `${t}_${stem}`;
}

/**
 * True when Workspace asked for this document, including ticker-scoped
 * values (`IBM_risk_snapshot`) so a ticker change is a new file id.
 * Content still follows the ticker param, not the prefix on the file name.
 */
export function isFileSelection(
  requested: string[],
  stem: string,
  extra: readonly string[] = [],
): boolean {
  const stemL = stem.toLowerCase();
  const extras = extra.map((s) => s.toLowerCase());
  return requested.some((name) => {
    const n = name.trim().toLowerCase();
    if (!n) return false;
    if (n === stemL || extras.includes(n)) return true;
    return (
      n.endsWith(`_${stemL}`) ||
      n.endsWith(`_${stemL}.pdf`) ||
      n.endsWith(`_${stemL}.xlsx`)
    );
  });
}

/** True when Workspace actually sent a fileSelector list (not a missing key). */
export function hasFileParam(params: URLSearchParams): boolean {
  return params.getAll("file").some((s) => s.trim().length > 0);
}

/**
 * Ticker prefix on a ticker-scoped file id (`IBM_risk_snapshot`).
 * Labels like "Risk Snapshot Tearsheet" do not match.
 */
export function tickerFromFileNames(
  names: string[],
  stem: string,
): string | null {
  const stemL = stem.toLowerCase();
  for (const raw of names) {
    const n = raw.trim();
    const lower = n.toLowerCase();
    for (const suffix of [`_${stemL}`, `_${stemL}.pdf`, `_${stemL}.xlsx`]) {
      if (!lower.endsWith(suffix) || n.length <= suffix.length) continue;
      const prefix = n.slice(0, n.length - suffix.length).trim();
      if (/^[A-Z][A-Z0-9.]{0,9}$/i.test(prefix)) return prefix.toUpperCase();
    }
  }
  return null;
}

export const WIDGET_NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
} as const;
