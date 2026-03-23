/**
 * Response Header Utilities
 *
 * Injects lineage metadata headers (X-Risk-*) and conditional headers (ETag, 304) into API responses.
 */

import type { RiskMetadata } from "./risk-metadata";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Build a weak ETag for cache validation.
 * Format: W/"data_as_of-{extra}" so clients can use If-None-Match.
 */
export function buildEtag(dataAsOf: string, extra?: string): string {
  const tag = extra ? `${dataAsOf}-${extra}` : dataAsOf;
  return `W/"${tag}"`;
}

/**
 * If the request has If-None-Match matching our ETag, return a 304 Response.
 * Otherwise return null (proceed with full response).
 */
export function maybe304(
  request: NextRequest,
  etag: string,
  extraHeaders?: Record<string, string>,
): NextResponse | null {
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (!ifNoneMatch) return null;
  const match = ifNoneMatch.split(/,\s*/).some((v) => v.trim() === etag);
  if (!match) return null;
  const res = new NextResponse(null, { status: 304 });
  res.headers.set("ETag", etag);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.headers.set(k, v);
    }
  }
  return res;
}

/**
 * Add lineage metadata headers to a Response.
 * Call this before returning from data endpoints.
 */
export function addMetadataHeaders(
  response: NextResponse,
  metadata: RiskMetadata,
): void {
  response.headers.set("X-Risk-Model-Version", metadata.model_version);
  response.headers.set("X-Data-As-Of", metadata.data_as_of);
  response.headers.set("X-Factor-Set-Id", metadata.factor_set_id);
  response.headers.set("X-Universe-Size", String(metadata.universe_size));
}

/**
 * Build _metadata object for JSON response body.
 */
export function buildMetadataBody(metadata: RiskMetadata): Record<string, unknown> {
  return {
    model_version: metadata.model_version,
    data_as_of: metadata.data_as_of,
    factor_set_id: metadata.factor_set_id,
    universe_size: metadata.universe_size,
    wiki_uri: metadata.wiki_uri,
    factors: [...metadata.factors],
  };
}
