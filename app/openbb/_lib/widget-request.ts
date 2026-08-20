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

export function namesMatch(
  requested: string[],
  aliases: readonly string[],
): boolean {
  const allowed = new Set(aliases.map((a) => a.toLowerCase()));
  return requested.some((name) => allowed.has(name.toLowerCase()));
}
