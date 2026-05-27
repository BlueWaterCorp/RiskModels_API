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

export type HistoryMetadataExtras = {
  data_source?: "zarr" | "supabase";
  /** Inclusive ISO date bounds for the returned history window (when applicable). */
  range?: [string, string];
  /** Number of history rows returned (0 when empty). */
  history_row_count?: number;
  /** Human-readable note when history is empty or partially missing. */
  data_warning?: string;
  /**
   * Override the global factor universe with the factors actually used for
   * this response (e.g. for a single ticker the L3 factors are
   * [SPY, sector_etf, subsector_etf] deduped, not all 12 sector ETFs).
   */
  factors?: readonly string[];
};

/** Standard copy for empty zarr history responses (support passback). */
export const EMPTY_HISTORY_DATA_WARNING =
  "No history rows returned for this ticker and date window. Retry once; if still empty, contact support with X-Request-ID (response header or _agent.request_id), request URL, and timestamp.";

export type AgentBodyInput = {
  request_id: string;
  cost_usd?: number;
};

/** Build _agent block for JSON history endpoints (mirrors batch/analyze shape). */
export function buildAgentBody(agent: AgentBodyInput): Record<string, unknown> {
  return {
    request_id: agent.request_id,
    ...(agent.cost_usd !== undefined ? { cost_usd: agent.cost_usd } : {}),
  };
}

/**
 * Build _metadata object for JSON response body.
 */
export function buildMetadataBody(
  metadata: RiskMetadata,
  extras?: HistoryMetadataExtras,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model_version: metadata.model_version,
    data_as_of: metadata.data_as_of,
    factor_set_id: metadata.factor_set_id,
    universe_size: metadata.universe_size,
    wiki_uri: metadata.wiki_uri,
    factors: extras?.factors ? [...extras.factors] : [...metadata.factors],
  };
  if (extras?.data_source) {
    body.data_source = extras.data_source;
  }
  if (extras?.range?.[0] && extras?.range?.[1]) {
    body.range = extras.range;
  }
  if (extras?.history_row_count !== undefined) {
    body.history_row_count = extras.history_row_count;
  }
  if (extras?.data_warning) {
    body.data_warning = extras.data_warning;
  }
  return body;
}
