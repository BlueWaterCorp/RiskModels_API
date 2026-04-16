/**
 * Cost Estimation for API Requests
 *
 * Maps endpoint + params to predicted cost before a request is made.
 * Used by POST /api/estimate for agent pre-flight checks.
 */

import { getCapabilityById, calculateRequestCost } from "./capabilities";
import { CHAT_TOOLS_REGISTRY } from "@/lib/chat/tools";

const TRADING_DAYS_PER_YEAR = 252;
const TOKEN_PRICE_USD = 0.00002;
const BYTES_PER_ROW = 40; // Approximate JSON size per time-series row

export interface EstimateRequest {
  endpoint: string;
  params?: Record<string, unknown>;
}

export interface EstimateResult {
  estimated_cost_usd: number;
  estimated_tokens: number;
  estimated_rows?: number;
  estimated_bytes?: number;
  capability: string;
  tier: "baseline" | "premium";
  pricing_model: string;
  unit_cost_usd?: number;
  min_charge?: number;
  note: string;
  /** POST /chat — per-tool reference prices (actual usage depends on the model). */
  available_tools?: Array<{
    name: string;
    capability_id: string | null;
    cost_per_call_usd: number;
  }>;
}

const ENDPOINT_TO_CAPABILITY: Record<string, string> = {
  "ticker-returns": "ticker-returns",
  "returns": "ticker-returns",
  "etf-returns": "ticker-returns",
  "batch-analyze": "batch-analysis",
  "batch-analysis": "batch-analysis",
  "cli-query": "cli-query",
  "metrics": "metrics-snapshot",
  "metrics-snapshot": "metrics-snapshot",
  "l3-decomposition": "l3-decomposition",
  "portfolio-returns": "portfolio-returns",
  "portfolio-risk-index": "portfolio-risk-index",
  "macro-factors": "macro-factor-series",
  "portfolio-risk-snapshot": "portfolio-risk-snapshot",
  "risk-snapshot": "portfolio-risk-snapshot",
  chat: "chat-risk-analyst",
};

function getItemCount(params: Record<string, unknown> | undefined): number | undefined {
  if (!params) return undefined;
  const tickers = params.tickers as string[] | undefined;
  if (Array.isArray(tickers)) return tickers.length;
  const positions = params.positions as Array<unknown> | undefined;
  if (Array.isArray(positions)) return positions.length;
  return undefined;
}

function getYears(params: Record<string, unknown> | undefined): number {
  if (!params || typeof params.years !== "number") return 1;
  return Math.min(15, Math.max(1, params.years));
}

function estimateChatTokensFromParams(params: Record<string, unknown> | undefined): {
  inputTokens: number;
  outputTokens: number;
} {
  const messages = params?.messages as { content?: string }[] | undefined;
  if (!messages?.length) {
    return { inputTokens: 500, outputTokens: 2000 };
  }
  let chars = 0;
  for (const m of messages) {
    chars += m.content?.length ?? 0;
  }
  return {
    inputTokens: Math.min(100_000, Math.max(120, Math.ceil(chars / 3) + 3000)),
    outputTokens: 2000,
  };
}

/**
 * Estimate row count for time-series endpoints (ticker-returns, returns, etf-returns).
 */
async function estimateRowCount(
  capabilityId: string,
  params: Record<string, unknown> | undefined,
): Promise<number | undefined> {
  if (!params?.ticker && !params?.etf) return undefined;

  const ticker = (params.ticker as string) ?? (params.etf as string);
  if (!ticker || typeof ticker !== "string") return undefined;

  const years = getYears(params);
  // Formula-based estimate: ~252 trading days × years, capped at ~15 years.
  // Previously this helper did an exact-count query against security_history
  // to get a precise number, but that table is gone post-Zarr-SSOT cutover
  // and the formula is accurate to within a few percent for any real range.
  return Math.min(TRADING_DAYS_PER_YEAR * 15, TRADING_DAYS_PER_YEAR * years);
}

/**
 * Estimate cost for an API request before it is made.
 */
export async function estimateCost(req: EstimateRequest): Promise<EstimateResult | null> {
  const endpoint = req.endpoint?.toLowerCase().trim();
  if (!endpoint) return null;

  const capabilityId = ENDPOINT_TO_CAPABILITY[endpoint];
  if (!capabilityId) return null;

  const capability = getCapabilityById(capabilityId);
  if (!capability) return null;

  const itemCount = getItemCount(req.params);
  const chatTokens =
    capabilityId === "chat-risk-analyst"
      ? estimateChatTokensFromParams(req.params)
      : null;
  const costUsd =
    chatTokens != null
      ? calculateRequestCost(
          capabilityId,
          chatTokens.inputTokens,
          chatTokens.outputTokens,
        )
      : calculateRequestCost(capabilityId, undefined, undefined, itemCount);

  const pricing = capability.pricing;
  const pricingModel =
    pricing.model === "per_request"
      ? "per_request"
      : pricing.model === "per_position"
        ? "per_position"
        : pricing.model === "per_token"
          ? "per_token"
          : "subscription";

  let estimatedRows: number | undefined;
  if (
    capabilityId === "ticker-returns" &&
    (req.params?.ticker || req.params?.etf)
  ) {
    estimatedRows = await estimateRowCount(capabilityId, req.params);
  }

  const estimatedTokens = Math.ceil(costUsd / TOKEN_PRICE_USD);
  const estimatedBytes = estimatedRows
    ? estimatedRows * BYTES_PER_ROW
    : undefined;

  const available_tools =
    capabilityId === "chat-risk-analyst"
      ? CHAT_TOOLS_REGISTRY.map((t) => ({
          name: t.name,
          capability_id: t.capabilityId,
          cost_per_call_usd: t.capabilityId
            ? calculateRequestCost(t.capabilityId)
            : 0,
        }))
      : undefined;

  return {
    estimated_cost_usd: costUsd,
    estimated_tokens: estimatedTokens,
    estimated_rows: estimatedRows,
    estimated_bytes: estimatedBytes,
    capability: capabilityId,
    tier: pricing.tier,
    pricing_model: pricingModel,
    unit_cost_usd: pricing.cost_usd,
    min_charge: pricing.min_charge,
    note:
      capabilityId === "chat-risk-analyst"
        ? "LLM token estimate only; each tool call is billed separately (see available_tools). search_tickers is free."
        : "Actual cost may vary. Cached responses are free.",
    ...(available_tools ? { available_tools } : {}),
  };
}
