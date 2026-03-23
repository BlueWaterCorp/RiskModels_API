/**
 * Free API Key Generation
 *
 * Generate a free API key with limited usage for testing and development.
 * No payment required. No email required.
 *
 * POST /api/auth/provision-free
 * Body: {
 *   agent_name: string,
 *   purpose?: string (optional)
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/agent/api-keys";

export const dynamic = "force-dynamic";

// Free tier limits
const FREE_TIER_LIMITS = {
  QUERIES_PER_DAY: 100,
  QUERIES_PER_MINUTE: 10,
  INITIAL_BALANCE: 0,
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const { agent_name, purpose = "development" } = body;

    if (!agent_name || typeof agent_name !== "string" || agent_name.trim().length < 3) {
      return NextResponse.json(
        {
          error: "Invalid agent_name",
          message: "agent_name is required and must be at least 3 characters",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // Generate user_id for free tier
    const freeUserId = `free_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate API key
    const { plainKey, hashedKey, prefix } = generateApiKey();

    // Create free tier account
    const { error: accountError } = await supabase.from("agent_accounts").insert({
      user_id: freeUserId,
      agent_id: `free_${agent_name.toLowerCase().replace(/\s+/g, "_")}`,
      agent_name,
      contact_email: null,
      balance_usd: FREE_TIER_LIMITS.INITIAL_BALANCE,
      status: "active",
      created_at: new Date().toISOString(),
    });

    if (accountError) {
      console.error("[Provision-Free] Account creation error:", accountError);
      return NextResponse.json(
        {
          error: "Failed to create account",
          message: accountError.message,
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }

    // Store hashed API key
    const { error: keyError } = await supabase.from("agent_api_keys").insert({
      user_id: freeUserId,
      key_hash: hashedKey,
      key_prefix: prefix,
      name: `Free Key - ${purpose}`,
      scopes: ["*"],
      rate_limit_per_minute: FREE_TIER_LIMITS.QUERIES_PER_MINUTE,
    });

    if (keyError) {
      console.error("[Provision-Free] Key storage error:", keyError);
      return NextResponse.json(
        {
          error: "Failed to store API key",
          message: keyError.message,
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }

    // Track free tier usage
    const { error: usageError } = await supabase.from("free_tier_usage").insert({
      user_id: freeUserId,
      queries_today: 0,
      queries_this_month: 0,
      last_query_at: null,
      reset_date: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
    });

    if (usageError) {
      console.error("[Provision-Free] Usage tracking error:", usageError);
    }

    return NextResponse.json(
      {
        account: {
          user_id: freeUserId,
          agent_name,
          tier: "free",
          limits: {
            queries_per_day: FREE_TIER_LIMITS.QUERIES_PER_DAY,
            queries_per_minute: FREE_TIER_LIMITS.QUERIES_PER_MINUTE,
          },
          created_at: new Date().toISOString(),
        },
        credentials: {
          api_key: plainKey, // ONLY SHOWN ONCE!
          prefix,
        },
        instructions: {
          next_steps: [
            "1. Store your API key securely (it will not be shown again)",
            "2. Use your API key in the Authorization header: Bearer <api_key>",
            "3. Check your usage limits at /api/auth/free-tier-status",
            "4. Upgrade to paid tier when ready at /settings",
          ],
          limits: {
            daily: FREE_TIER_LIMITS.QUERIES_PER_DAY,
            per_minute: FREE_TIER_LIMITS.QUERIES_PER_MINUTE,
          },
          warnings: [
            "Your API key is shown only once. If lost, generate a new one.",
            "Free tier resets daily at midnight UTC.",
          ],
        },
        _agent: {
          latency_ms: Date.now() - startTime,
        },
      },
      {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("[Provision-Free API] Error:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
        _agent: { latency_ms: Date.now() - startTime },
      },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
