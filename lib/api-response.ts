/**
 * API Response Helpers — standardized response formatting with billing metadata.
 */

import { NextResponse } from "next/server";

export interface ApiResponseOptions {
  costUsd?: number;
  requestId: string;
  latencyMs: number;
  cacheStatus?: "HIT" | "MISS" | "BYPASS";
  dataFreshness?: string;
  billingCode?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

/**
 * Create a successful API response with billing metadata.
 */
export function createApiResponse(
  data: Record<string, unknown>,
  options: ApiResponseOptions,
): NextResponse {
  const headers: Record<string, string> = {
    "X-Request-ID": options.requestId,
    "X-Response-Latency-Ms": String(options.latencyMs),
  };

  if (options.costUsd !== undefined) {
    headers["X-API-Cost-USD"] = String(options.costUsd);
    headers["X-API-Cost-Currency"] = "USD";
  }

  if (options.cacheStatus) {
    headers["X-Cache-Status"] = options.cacheStatus;
  }

  if (options.dataFreshness) {
    headers["X-Data-Freshness"] = options.dataFreshness;
  }

  if (options.billingCode) {
    headers["X-API-Billing-Code"] = options.billingCode;
  }

  if (options.rateLimit) {
    headers["X-RateLimit-Limit"] = String(options.rateLimit.limit);
    headers["X-RateLimit-Remaining"] = String(options.rateLimit.remaining);
    headers["X-RateLimit-Reset"] = String(options.rateLimit.reset);
  }

  // Add _agent block to response body
  const responseBody = {
    ...data,
    _agent: {
      cost_usd: options.costUsd ?? 0,
      cost_currency: "USD",
      latency_ms: options.latencyMs,
      request_id: options.requestId,
      cache_status: options.cacheStatus ?? "MISS",
      ...(options.dataFreshness && { data_freshness: options.dataFreshness }),
      ...(options.billingCode && { billing_code: options.billingCode }),
    },
  };

  return NextResponse.json(responseBody, { headers });
}

/**
 * Create an error response following the standard error schema.
 */
export function createErrorResponse(
  error: string,
  message: string,
  code: number,
  details?: Record<string, unknown>,
  requestId?: string,
): NextResponse {
  const headers: Record<string, string> = {};
  if (requestId) {
    headers["X-Request-ID"] = requestId;
  }

  // Add Retry-After header for 429 responses
  if (code === 429) {
    headers["Retry-After"] = "60";
  }

  const body: Record<string, unknown> = {
    error,
    message,
    code,
  };

  if (details) {
    body.details = details;
  }

  return NextResponse.json(body, { status: code, headers });
}

/**
 * Pricing constants for metered endpoints.
 */
export const PRICING = {
  METRICS: 0.005,
  TICKER_RETURNS: 0.005,
  RETURNS: 0.005,
  ETF_RETURNS: 0.005,
  L3_DECOMPOSITION: 0.02,
  BATCH_ANALYZE_PER_POSITION: 0.005,
  BATCH_ANALYZE_MIN: 0.01,
  TICKERS: 0.001,
  TELEMETRY: 0.002,
  PLAID_HOLDINGS: 0.02,
  CHAT_PER_1K_TOKENS: 0.01,
} as const;

/**
 * Estimate cost for an endpoint.
 */
export function estimateCost(
  endpoint: string,
  params?: { tickers?: number; positions?: number; tokens?: number },
): number {
  switch (endpoint) {
    case "metrics":
      return PRICING.METRICS;
    case "ticker-returns":
      return PRICING.TICKER_RETURNS;
    case "returns":
      return PRICING.RETURNS;
    case "etf-returns":
      return PRICING.ETF_RETURNS;
    case "l3-decomposition":
      return PRICING.L3_DECOMPOSITION;
    case "batch-analyze":
      return Math.max(
        PRICING.BATCH_ANALYZE_MIN,
        (params?.positions ?? params?.tickers ?? 1) * PRICING.BATCH_ANALYZE_PER_POSITION,
      );
    case "tickers":
      return PRICING.TICKERS;
    case "telemetry":
      return PRICING.TELEMETRY;
    case "plaid-holdings":
      return PRICING.PLAID_HOLDINGS;
    case "chat":
      return (params?.tokens ?? 1000) * PRICING.CHAT_PER_1K_TOKENS;
    default:
      return 0.005;
  }
}
