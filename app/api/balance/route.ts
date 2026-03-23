/**
 * User Balance Endpoint
 *
 * Returns current account balance and billing information for authenticated users.
 * Supports both agent accounts and regular user accounts during transition.
 *
 * GET /api/balance
 * PATCH /api/balance - Update auto-refill settings
 */

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getUserBalance,
  getUsageStats,
  getBillingHistory,
} from "@/lib/agent/billing";
import { createAgentErrorResponse } from "@/lib/agent/response-utils";
import { generateRequestId } from "@/lib/agent/telemetry";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";

// Token conversion: $20 = 1M tokens
const TOKEN_PRICE_USD = 0.00002;

export async function GET(request: Request) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  try {
    // Authenticate request
    const { user, error: authError } = await authenticateRequest(request);

    if (authError || !user) {
      return createAgentErrorResponse(
        "Unauthorized",
        "AUTHENTICATION_FAILED",
        401,
        "balance-check",
        requestId,
        { auth_error: authError },
      );
    }

    console.log(
      `[Balance API] Request for user ${user.id}, email: ${user.email}`,
    );

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const includeUsage = searchParams.get("include_usage") === "true";
    const includeHistory = searchParams.get("include_history") === "true";
    const days = parseInt(searchParams.get("days") || "30");
    const limit = parseInt(searchParams.get("limit") || "50");

    // Get current balance
    const balance = await getUserBalance(user.id);

    // Get auto-refill settings from agent_accounts
    const supabase = createAdminClient();
    const { data: agentAccount } = await supabase
      .from('agent_accounts')
      .select('auto_top_up, auto_top_up_threshold, auto_top_up_amount')
      .eq('user_id', user.id)
      .maybeSingle();

    // Calculate token balance
    const balanceTokens = Math.floor(balance / TOKEN_PRICE_USD);

    console.log(`[Balance API] User ${user.id} balance: $${balance} (${balanceTokens} tokens)`);

    // Build response data
    const responseData: any = {
      user_id: user.id,
      email: user.email,
      balance_usd: balance,
      balance_tokens: balanceTokens,
      currency: "USD",
      last_updated: new Date().toISOString(),
      account_type: "agent", // Will be 'standard' for non-agent accounts during transition
      auto_refill: {
        enabled: agentAccount?.auto_top_up ?? false,
        min_threshold_tokens: agentAccount?.auto_top_up_threshold
          ? Math.floor(agentAccount.auto_top_up_threshold / TOKEN_PRICE_USD)
          : 100000,
        refill_amount_usd: agentAccount?.auto_top_up_amount
          ? Number(agentAccount.auto_top_up_amount)
          : 50,
        refill_tokens: agentAccount?.auto_top_up_amount
          ? Math.floor(Number(agentAccount.auto_top_up_amount) / TOKEN_PRICE_USD)
          : Math.floor(50 / TOKEN_PRICE_USD),
      },
      _links: {
        top_up: `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/top-up`,
        invoices: `${process.env.NEXT_PUBLIC_APP_URL}/api/invoices`,
        usage: `${process.env.NEXT_PUBLIC_APP_URL}/api/usage`,
      },
    };

    // Add usage statistics if requested
    if (includeUsage) {
      try {
        const usageStats = await getUsageStats(user.id, days);
        responseData.usage_stats = usageStats;
        responseData.period_days = days;
      } catch (usageError) {
        console.error(
          `[Balance API] Error getting usage stats for user ${user.id}:`,
          usageError,
        );
        responseData.usage_stats_error = "Failed to retrieve usage statistics";
      }
    }

    // Add billing history if requested
    if (includeHistory) {
      try {
        const billingHistory = await getBillingHistory(user.id, limit);
        responseData.billing_history = billingHistory;
        responseData.history_limit = limit;
      } catch (historyError) {
        console.error(
          `[Balance API] Error getting billing history for user ${user.id}:`,
          historyError,
        );
        responseData.billing_history_error =
          "Failed to retrieve billing history";
      }
    }

    // Add account status and limits
    responseData.status = {
      account: "active",
      billing: balance > 0 ? "active" : "low_balance",
      can_make_requests: balance > 0,
    };

    responseData.limits = {
      rate_limit_per_minute: 60,
      concurrent_requests: 10,
      daily_request_limit: 10000,
    };

    // Calculate response latency
    const latencyMs = Date.now() - startTime;

    // Create enhanced response with agent metadata
    const response = NextResponse.json(responseData, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Request-ID": requestId,
        "X-Response-Latency-Ms": latencyMs.toString(),
        "X-Capability-ID": "balance-check",
        "X-API-Cost-USD": "0.000000",
        "X-Confidence-Score": "0.99",
      },
    });

    const metadata = await getRiskMetadata();
    addMetadataHeaders(response, metadata);

    console.log(
      `[Balance API] Successfully returned balance for user ${user.id} in ${latencyMs}ms`,
    );

    return response;
  } catch (error) {
    console.error("[Balance API] Error processing request:", error);

    return createAgentErrorResponse(
      "Internal server error",
      "INTERNAL_ERROR",
      500,
      "balance-check",
      requestId,
      {
        error_details: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }
}

/**
 * PATCH /api/balance
 *
 * Update auto-refill settings for the authenticated user
 */
export async function PATCH(request: Request) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  try {
    // Authenticate request
    const { user, error: authError } = await authenticateRequest(request);

    if (authError || !user) {
      return createAgentErrorResponse(
        "Unauthorized",
        "AUTHENTICATION_FAILED",
        401,
        "balance-update",
        requestId,
        { auth_error: authError },
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return createAgentErrorResponse(
        "Invalid request body",
        "INVALID_BODY",
        400,
        "balance-update",
        requestId,
      );
    }

    const { enabled, min_threshold_tokens, refill_amount_usd } = body;

    // Validate required fields
    if (typeof enabled !== 'boolean') {
      return createAgentErrorResponse(
        "Missing required field: enabled (boolean)",
        "INVALID_PARAMS",
        400,
        "balance-update",
        requestId,
      );
    }

    const allowedRefillUsd = [20, 50, 100] as const;

    const supabase = createAdminClient();

    const updatePayload: Record<string, unknown> = {
      auto_top_up: enabled,
      updated_at: new Date().toISOString(),
    };

    if (typeof refill_amount_usd === "number") {
      if (!allowedRefillUsd.includes(refill_amount_usd as (typeof allowedRefillUsd)[number])) {
        return createAgentErrorResponse(
          `refill_amount_usd must be one of: ${allowedRefillUsd.join(", ")}`,
          "INVALID_PARAMS",
          400,
          "balance-update",
          requestId,
        );
      }
      updatePayload.auto_top_up_amount = refill_amount_usd;
    } else if (enabled) {
      return createAgentErrorResponse(
        "refill_amount_usd (20 | 50 | 100) is required when enabling auto-refill",
        "INVALID_PARAMS",
        400,
        "balance-update",
        requestId,
      );
    }

    let thresholdUsd = 5.0;
    if (min_threshold_tokens !== undefined && min_threshold_tokens !== null) {
      thresholdUsd = Number(min_threshold_tokens) * TOKEN_PRICE_USD;
      if (thresholdUsd < 5 || thresholdUsd > 50) {
        return createAgentErrorResponse(
          "min_threshold_tokens implies threshold USD between $5 and $50",
          "INVALID_PARAMS",
          400,
          "balance-update",
          requestId,
        );
      }
      updatePayload.auto_top_up_threshold = thresholdUsd;
    } else if (enabled) {
      return createAgentErrorResponse(
        "min_threshold_tokens is required when enabling auto-refill",
        "INVALID_PARAMS",
        400,
        "balance-update",
        requestId,
      );
    }

    const { error: updateError } = await supabase
      .from('agent_accounts')
      .update(updatePayload)
      .eq('user_id', user.id);

    if (updateError) {
      console.error(`[Balance API] Error updating auto-refill for user ${user.id}:`, updateError);
      return createAgentErrorResponse(
        "Failed to update auto-refill settings",
        "UPDATE_FAILED",
        500,
        "balance-update",
        requestId,
        { details: updateError.message },
      );
    }

    const { data: updatedAccount } = await supabase
      .from('agent_accounts')
      .select('auto_top_up, auto_top_up_threshold, auto_top_up_amount')
      .eq('user_id', user.id)
      .maybeSingle();

    const finalAmount = Number(updatedAccount?.auto_top_up_amount ?? 50);
    const finalThresholdUsd = Number(updatedAccount?.auto_top_up_threshold ?? 5);

    console.log(`[Balance API] Updated auto-refill for user ${user.id}: enabled=${enabled}`);

    const latencyMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: "Auto-refill settings updated",
      auto_refill: {
        enabled: updatedAccount?.auto_top_up ?? enabled,
        min_threshold_tokens: Math.floor(finalThresholdUsd / TOKEN_PRICE_USD),
        refill_amount_usd: finalAmount,
        refill_tokens: Math.floor(finalAmount / TOKEN_PRICE_USD),
      },
    }, {
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        "X-Response-Latency-Ms": latencyMs.toString(),
      },
    });
  } catch (error) {
    console.error("[Balance API] Error processing PATCH request:", error);

    return createAgentErrorResponse(
      "Internal server error",
      "INTERNAL_ERROR",
      500,
      "balance-update",
      requestId,
      {
        error_details: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }
}

/**
 * Handle OPTIONS requests for CORS
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
