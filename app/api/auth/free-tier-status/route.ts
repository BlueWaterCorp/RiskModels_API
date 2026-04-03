/**
 * Free Tier Status Check
 *
 * Returns current usage and limits for a free tier API key.
 *
 * GET /api/auth/free-tier-status
 * Headers: Authorization: Bearer <api_key>
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateApiKey } from "@/lib/agent/api-keys";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "Missing authorization",
          message: "Authorization header with Bearer token required",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 401 },
      );
    }

    const apiKey = authHeader.substring(7); // Remove "Bearer "

    // Verify API key
    const validation = await validateApiKey(apiKey);
    if (!validation.valid || !validation.userId) {
      return NextResponse.json(
        {
          error: "Invalid API key",
          message: validation.error || "The provided API key is invalid",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 401 },
      );
    }

    const userId = validation.userId;
    const supabase = createAdminClient();

    // Get account tier (avoid .single(): 0 rows is not invalid key; 2+ rows is data issue)
    const { data: accountRows, error: accountError } = await supabase
      .from("agent_accounts")
      .select("tier, rate_limit_per_minute")
      .eq("user_id", userId)
      .limit(2);

    if (accountError) {
      // Do not return 5xx: smoke tests and clients treat this as a health signal; billing still works via GET /balance.
      console.error("[Free Tier Status] agent_accounts:", accountError);
      return NextResponse.json(
        {
          tier: "unavailable",
          message:
            "Could not load billing profile. Use GET /balance for account status.",
          _agent: {
            latency_ms: Date.now() - startTime,
            degraded: true,
          },
        },
        { status: 200 },
      );
    }

    const account = accountRows?.[0];
    if (!account) {
      return NextResponse.json(
        {
          tier: "unlinked",
          message:
            "No agent_accounts row for this user. Use GET /balance after onboarding, or contact support if billing works but this persists.",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 200 },
      );
    }

    if (accountRows && accountRows.length > 1) {
      console.warn(
        "[Free Tier Status] duplicate agent_accounts for user_id",
        userId,
      );
    }

    // If not free tier, return different response
    if (account.tier !== "free") {
      return NextResponse.json(
        {
          tier: account.tier,
          message: "This endpoint is for free tier accounts only",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 200 },
      );
    }

    // Get free tier usage
    const { data: usage, error: usageError } = await supabase
      .from("free_tier_usage")
      .select("queries_today, queries_this_month, reset_date, last_query_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (usageError) {
      // Table missing, schema drift, or transient DB error — assume zero usage instead of failing health checks.
      console.error("[Free Tier Status] free_tier_usage:", usageError);
      return NextResponse.json(
        {
          tier: "free",
          user_id: userId,
          usage: {
            queries_today: 0,
            queries_this_month: 0,
            remaining_today: 100,
          },
          limits: {
            queries_per_day: 100,
            queries_per_minute: 10,
          },
          reset_date: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
          message:
            "Usage row unavailable; showing defaults until storage is reachable.",
          _agent: {
            latency_ms: Date.now() - startTime,
            degraded: true,
          },
        },
        { status: 200 },
      );
    }

    if (!usage) {
      // No usage row yet — same defaults as before
      return NextResponse.json(
        {
          tier: "free",
          user_id: userId,
          usage: {
            queries_today: 0,
            queries_this_month: 0,
            remaining_today: 100,
          },
          limits: {
            queries_per_day: 100,
            queries_per_minute: 10,
          },
          reset_date: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 200 },
      );
    }

    // Calculate remaining queries
    const remaining = Math.max(0, 100 - (usage.queries_today || 0));

    return NextResponse.json(
      {
        tier: "free",
        user_id: userId,
        usage: {
          queries_today: usage.queries_today || 0,
          queries_this_month: usage.queries_this_month || 0,
          remaining_today: remaining,
        },
        limits: {
          queries_per_day: 100,
          queries_per_minute: 10,
        },
        reset_date: usage.reset_date,
        last_query_at: usage.last_query_at,
        _agent: { latency_ms: Date.now() - startTime },
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("[Free Tier Status] Error:", error);

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
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
