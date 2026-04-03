/**
 * Agent Response Utilities
 *
 * Enhances API responses with agent-specific metadata, pricing headers,
 * and confidence scoring.
 */

import { NextResponse } from 'next/server';
import { calculateRequestCost, getCapabilityById } from './capabilities';
import { generateRequestId } from './telemetry';

export interface AgentMetadata {
  cost_usd: number;
  cost_currency: string;
  latency_ms: number;
  confidence_score: number;
  data_freshness: string;
  request_id: string;
  capability_id: string;
  billing_code: string;
  confidence?: {
    overall: number;
    factors: Record<string, number>;
    warnings: string[];
    methodology?: string;
  };
  alternatives?: Array<{
    capability: string;
    cost_usd: number;
    confidence: number;
    endpoint: string;
    description: string;
  }>;
}

export interface EnhancedResponseOptions {
  capabilityId: string;
  latencyMs: number;
  requestId?: string;
  confidenceScore?: number;
  dataFreshness?: string | Date;
  inputTokens?: number;
  outputTokens?: number;
  itemCount?: number;
  warnings?: string[];
  alternatives?: AgentMetadata['alternatives'];
  customMetadata?: Record<string, any>;
}

/**
 * Create an enhanced API response with agent-specific metadata
 */
export function createAgentResponse(
  data: any,
  options: EnhancedResponseOptions
): NextResponse {
  const {
    capabilityId,
    latencyMs,
    requestId = generateRequestId(),
    confidenceScore = 0.98,
    dataFreshness = new Date().toISOString(),
    inputTokens,
    outputTokens,
    itemCount,
    warnings = [],
    alternatives,
    customMetadata = {}
  } = options;

  try {
    // Calculate cost based on capability and usage
    const costUsd = calculateRequestCost(
      capabilityId,
      inputTokens,
      outputTokens,
      itemCount
    );

    const capability = getCapabilityById(capabilityId);
    const billingCode = capability?.pricing.billing_code || capabilityId;

    // Create agent metadata
    const agentMetadata: AgentMetadata = {
      cost_usd: costUsd,
      cost_currency: 'USD',
      latency_ms: latencyMs,
      confidence_score: confidenceScore,
      data_freshness: dataFreshness instanceof Date ? dataFreshness.toISOString() : dataFreshness,
      request_id: requestId,
      capability_id: capabilityId,
      billing_code: billingCode,
      confidence: {
        overall: confidenceScore,
        factors: {
          data_completeness: 1.0,
          data_freshness: calculateFreshnessScore(dataFreshness),
          model_accuracy: 0.99,
          historical_coverage: 1.0
        },
        warnings: warnings,
        methodology: 'https://riskmodels.net/docs/methodology'
      },
      alternatives: alternatives
    };

    // Create response with enhanced data structure
    const enhancedData = {
      ...data,
      _agent: agentMetadata,
      _metadata: {
        timestamp: new Date().toISOString(),
        version: process.env.API_VERSION || '2.0.0-agent',
        ...customMetadata
      }
    };

    // Create response with headers
    const response = NextResponse.json(enhancedData);

    // Add agent-specific headers
    response.headers.set('X-Request-ID', requestId);
    response.headers.set('X-API-Cost-USD', costUsd.toFixed(6));
    response.headers.set('X-API-Cost-Currency', 'USD');
    response.headers.set('X-API-Billing-Code', billingCode);
    response.headers.set('X-Response-Latency-Ms', latencyMs.toString());
    response.headers.set('X-Confidence-Score', confidenceScore.toFixed(3));
    response.headers.set('X-Data-Freshness', agentMetadata.data_freshness);
    response.headers.set('X-Capability-ID', capabilityId);

    // Add rate limiting headers if available
    response.headers.set('X-RateLimit-Limit', '60');
    response.headers.set('X-RateLimit-Remaining', '59'); // This should be dynamic
    response.headers.set('X-RateLimit-Reset', Math.floor(Date.now() / 1000 + 3600).toString());

    return response;
  } catch (error) {
    console.error('[Agent Response] Error creating enhanced response:', error);

    // Fallback to basic response
    return NextResponse.json({
      ...data,
      _error: 'Failed to enhance response with agent metadata'
    });
  }
}

/**
 * Add agent headers to an existing response
 */
export function addAgentHeaders(
  response: NextResponse,
  options: EnhancedResponseOptions
): NextResponse {
  const {
    capabilityId,
    latencyMs,
    requestId = generateRequestId(),
    confidenceScore = 0.98,
    dataFreshness = new Date().toISOString(),
    inputTokens,
    outputTokens,
    itemCount
  } = options;

  try {
    // Calculate cost
    const costUsd = calculateRequestCost(
      capabilityId,
      inputTokens,
      outputTokens,
      itemCount
    );

    const capability = getCapabilityById(capabilityId);
    const billingCode = capability?.pricing.billing_code || capabilityId;

    // Add headers to existing response
    response.headers.set('X-Request-ID', requestId);
    response.headers.set('X-API-Cost-USD', costUsd.toFixed(6));
    response.headers.set('X-API-Cost-Currency', 'USD');
    response.headers.set('X-API-Billing-Code', billingCode);
    response.headers.set('X-Response-Latency-Ms', latencyMs.toString());
    response.headers.set('X-Confidence-Score', confidenceScore.toFixed(3));
    response.headers.set('X-Data-Freshness', dataFreshness instanceof Date ? dataFreshness.toISOString() : dataFreshness);
    response.headers.set('X-Capability-ID', capabilityId);

    return response;
  } catch (error) {
    console.error('[Agent Response] Error adding headers:', error);
    return response;
  }
}

/**
 * Calculate freshness score based on data age
 */
function calculateFreshnessScore(dataFreshness: string | Date): number {
  try {
    const freshnessDate = dataFreshness instanceof Date ? dataFreshness : new Date(dataFreshness);
    const now = new Date();
    const hoursOld = (now.getTime() - freshnessDate.getTime()) / (1000 * 60 * 60);

    // Score decreases as data gets older
    if (hoursOld < 24) return 1.0;      // Less than 1 day: perfect score
    if (hoursOld < 48) return 0.95;     // 1-2 days: excellent
    if (hoursOld < 72) return 0.90;     // 2-3 days: very good
    if (hoursOld < 168) return 0.85;    // 3-7 days: good
    if (hoursOld < 720) return 0.75;    // 1 month: acceptable
    return 0.5;                          // Older: warning level
  } catch {
    return 0.5; // Default if date parsing fails
  }
}

/**
 * Create a payment required response (HTTP 402)
 */
export function createPaymentRequiredResponse(
  requiredAmount: number,
  currentBalance: number,
  capabilityId: string,
  requestId?: string
): NextResponse {
  const requestIdFinal = requestId || generateRequestId();
  const topUpUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/top-up`;

  return NextResponse.json(
    {
      error: 'Payment Required',
      error_code: 'INSUFFICIENT_BALANCE',
      message: `This request costs $${requiredAmount.toFixed(4)} but your current balance is $${currentBalance.toFixed(4)}`,
      required_amount_usd: requiredAmount,
      current_balance_usd: currentBalance,
      top_up_url: topUpUrl,
      _agent: {
        action: 'top_up_required',
        min_top_up: 10.00,
        next_steps: [
          `Visit ${topUpUrl} to add funds`,
          'Minimum top-up: $10.00',
          'Retry this request after adding funds',
          'Monitor your balance at /api/balance'
        ],
        capability_id: capabilityId,
        alternatives: [
          {
            capability: 'balance-check',
            cost_usd: 0,
            description: 'Check your current balance',
            endpoint: '/api/balance'
          }
        ]
      }
    },
    {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestIdFinal,
        'X-API-Cost-USD': requiredAmount.toFixed(6),
        'X-Current-Balance-USD': currentBalance.toFixed(6),
        'X-Top-Up-URL': topUpUrl,
        'X-Capability-ID': capabilityId,
        'Cache-Control': 'no-cache'
      }
    }
  );
}

/**
 * Create an error response with agent metadata
 */
export function createAgentErrorResponse(
  error: string,
  errorCode: string,
  status: number,
  capabilityId?: string,
  requestId?: string,
  additionalContext?: Record<string, any>
): NextResponse {
  const requestIdFinal = requestId || generateRequestId();

  return NextResponse.json(
    {
      error,
      error_code: errorCode,
      _agent: {
        request_id: requestIdFinal,
        capability_id: capabilityId,
        timestamp: new Date().toISOString(),
        support: 'service@riskmodels.app',
        documentation: 'https://riskmodels.net/docs/api',
        ...additionalContext
      }
    },
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestIdFinal,
        'X-Capability-ID': capabilityId || 'unknown',
        'Cache-Control': 'no-cache'
      }
    }
  );
}

/**
 * Extract agent metadata from response data
 */
export function extractAgentMetadata(data: any): AgentMetadata | null {
  if (data && data._agent) {
    return data._agent as AgentMetadata;
  }
  return null;
}

/**
 * Create usage statistics response
 */
export function createUsageStatsResponse(
  stats: {
    total_requests: number;
    total_cost: number;
    average_cost_per_request: number;
    top_capabilities: Array<{ capability_id: string; count: number; total_cost: number }>;
    period_days: number;
  },
  userId: string
): NextResponse {
  return createAgentResponse(
    {
      usage_stats: stats,
      period: {
        days: stats.period_days,
        start_date: new Date(Date.now() - stats.period_days * 24 * 60 * 60 * 1000).toISOString(),
        end_date: new Date().toISOString()
      },
      user_id: userId
    },
    {
      capabilityId: 'telemetry-metrics',
      latencyMs: 100,
      confidenceScore: 0.99
    }
  );
}
