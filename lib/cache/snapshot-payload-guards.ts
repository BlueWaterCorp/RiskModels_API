/**
 * Validate Redis cache payloads before treating them as HITs.
 *
 * Upstash may return partial/stale JSON; empty strings are truthy object keys
 * but must not be served as real PNG/PDF bytes. (See zarr-reader empty-rows
 * cache fix — same class of bug as `if (hit)` on `{ base64: "" }`.)
 */

export type PortfolioRiskSnapshotCache =
  | { kind: "json"; body: string; contentType: string }
  | { kind: "pdf"; base64: string }
  | { kind: "png"; base64: string };

export function isDdSnapshotCacheHit(hit: unknown): hit is {
  base64: string;
  contentType: string;
  lastModified?: string;
  etag?: string;
} {
  if (!hit || typeof hit !== "object") return false;
  const o = hit as Record<string, unknown>;
  return (
    typeof o.base64 === "string" &&
    o.base64.length > 0 &&
    typeof o.contentType === "string" &&
    o.contentType.length > 0
  );
}

export function isRasterSnapshotCacheHit(hit: unknown): hit is { base64: string } {
  if (!hit || typeof hit !== "object") return false;
  const b = (hit as Record<string, unknown>).base64;
  return typeof b === "string" && b.length > 0;
}

export function isPortfolioRiskSnapshotCacheHit(
  hit: unknown,
): hit is PortfolioRiskSnapshotCache {
  if (!hit || typeof hit !== "object") return false;
  const o = hit as Record<string, unknown>;
  const k = o.kind;
  if (k === "json") {
    return (
      typeof o.body === "string" &&
      o.body.length > 0 &&
      typeof o.contentType === "string" &&
      o.contentType.length > 0
    );
  }
  if (k === "png" || k === "pdf") {
    return typeof o.base64 === "string" && o.base64.length > 0;
  }
  return false;
}
