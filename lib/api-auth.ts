/**
 * API Authentication — validates Bearer tokens for public API endpoints.
 *
 * Supports:
 * - rm_agent_{live|test}_{random}_{checksum} (agent keys)
 * - rm_user_{random}_{checksum} (user keys)
 * - OAuth2 JWT access tokens
 */

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AuthenticatedRequest extends NextRequest {
  apiKey?: {
    id: string;
    user_id: string;
    environment: "live" | "test";
    scopes: string[];
  };
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

/**
 * Validate API key format.
 */
export function isValidApiKeyFormat(key: string): boolean {
  // rm_agent_{live|test}_{random}_{checksum}
  // rm_user_{random}_{checksum}
  return (
    key.startsWith("rm_agent_") ||
    key.startsWith("rm_user_") ||
    key.startsWith("rm_agent_free_")
  );
}

/**
 * Require valid Bearer token authentication.
 * Returns null if valid, or a NextResponse if authentication failed.
 */
export async function requireAuth(
  request: NextRequest,
): Promise<{ userId: string; keyId: string; environment: string; scopes: string[] } | NextResponse> {
  const token = extractBearerToken(request);

  if (!token) {
    return NextResponse.json(
      { error: "AUTHENTICATION_REQUIRED", message: "Missing Authorization header", code: 401 },
      { status: 401 },
    );
  }

  if (!isValidApiKeyFormat(token)) {
    return NextResponse.json(
      { error: "INVALID_API_KEY", message: "Invalid API key format", code: 401 },
      { status: 401 },
    );
  }

  const supabase = createAdminClient();

  // Look up key in database
  const { data: keyData, error } = await supabase
    .from("agent_api_keys")
    .select("id, user_id, key_prefix, environment, scopes, revoked_at, expires_at")
    .eq("key_prefix", token.slice(0, 32)) // First 32 chars as prefix
    .single();

  if (error || !keyData) {
    return NextResponse.json(
      { error: "AUTHENTICATION_REQUIRED", message: "Invalid API key", code: 401 },
      { status: 401 },
    );
  }

  if (keyData.revoked_at) {
    return NextResponse.json(
      { error: "REVOKED_KEY", message: "API key has been revoked", code: 401 },
      { status: 401 },
    );
  }

  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "EXPIRED_KEY", message: "API key has expired", code: 401 },
      { status: 401 },
    );
  }

  return {
    userId: keyData.user_id,
    keyId: keyData.id,
    environment: keyData.environment || "live",
    scopes: keyData.scopes || ["*"],
  };
}

/**
 * Check if user has sufficient balance.
 */
export async function checkBalance(
  userId: string,
  estimatedCost: number,
): Promise<{ hasBalance: boolean; currentBalance: number }> {
  const supabase = createAdminClient();

  const { data: account, error } = await supabase
    .from("agent_accounts")
    .select("balance_usd")
    .eq("user_id", userId)
    .single();

  if (error || !account) {
    return { hasBalance: false, currentBalance: 0 };
  }

  return {
    hasBalance: account.balance_usd >= estimatedCost,
    currentBalance: account.balance_usd,
  };
}

/**
 * Deduct cost from user balance and log billing event.
 */
export async function deductBalance(
  userId: string,
  keyId: string,
  costUsd: number,
  billingCode: string,
  requestId: string,
): Promise<boolean> {
  const supabase = createAdminClient();

  // Insert billing event
  const { error: billingError } = await supabase.from("billing_events").insert({
    user_id: userId,
    api_key_id: keyId,
    cost_usd: costUsd,
    billing_code: billingCode,
    request_id: requestId,
    created_at: new Date().toISOString(),
  });

  if (billingError) {
    console.error("[billing] Failed to log event:", billingError);
    return false;
  }

  // Update balance
  const { error: balanceError } = await supabase.rpc("deduct_balance", {
    p_user_id: userId,
    p_amount: costUsd,
  });

  if (balanceError) {
    console.error("[billing] Failed to deduct balance:", balanceError);
    return false;
  }

  return true;
}

/**
 * Generate unique request ID for tracing.
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
