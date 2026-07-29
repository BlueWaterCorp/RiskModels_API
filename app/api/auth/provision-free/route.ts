/**
 * Free API Key Generation
 *
 * Generate a free-tier API key for testing and development — no payment, no
 * signup. The key is bound to an anonymous Supabase auth user (required: the
 * agent_accounts.user_id / agent_api_keys.user_id columns are UUID FKs to
 * auth.users), and the account is created with tier='free' so the billing
 * middleware skips the balance check (see lib/agent/billing-middleware.ts —
 * the balance gate is `costUsd > 0 && tier !== 'free'`). Usage is capped at
 * FREE_TIER_LIMITS by checkFreeTierLimit().
 *
 * POST /api/auth/provision-free
 * Body: { agent_name: string, purpose?: string, referral_code?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/agent/api-keys";
import {
  findActiveAffiliateByCode,
  MAX_REFERRAL_CODE_LEN,
} from "@/lib/agent/affiliate";

export const dynamic = "force-dynamic";

// Free tier limits
const FREE_TIER_LIMITS = {
  QUERIES_PER_DAY: 100,
  QUERIES_PER_MINUTE: 10,
  INITIAL_BALANCE: 0,
};

// Anti-abuse: this endpoint is unauthenticated and creates a real auth user +
// free key per request. Cap provisions per source IP per rolling 24h so it
// can't be spammed into unlimited free accounts.
const MAX_FREE_KEYS_PER_IP_PER_DAY = 3;

function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const { agent_name, purpose = "development" } = body;
    let referralCodeRaw: string | null =
      typeof body.referral_code === "string" && body.referral_code.trim()
        ? body.referral_code.trim()
        : null;
    if (referralCodeRaw && referralCodeRaw.length > MAX_REFERRAL_CODE_LEN) {
      referralCodeRaw = null;
    }

    if (
      !agent_name ||
      typeof agent_name !== "string" ||
      agent_name.trim().length < 3
    ) {
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
    const ip = clientIp(request);

    // --- Anti-abuse: per-IP daily cap (best-effort; skipped if IP unknown) ---
    if (ip !== "unknown") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("agent_accounts")
        .select("id", { count: "exact", head: true })
        .eq("signup_attribution->>provisioned_via", "provision-free")
        .eq("signup_attribution->>ip", ip)
        .gte("created_at", since);
      if ((count ?? 0) >= MAX_FREE_KEYS_PER_IP_PER_DAY) {
        return NextResponse.json(
          {
            error: "Rate limit exceeded",
            message:
              "Too many free keys from this IP in the last 24h. Create a free $20-credit key at https://riskmodels.app/get-key instead.",
            _agent: { latency_ms: Date.now() - startTime },
          },
          { status: 429 },
        );
      }
    }

    // --- Create a real anonymous auth user (FK target for the account/key) ---
    const syntheticEmail = `agent-free+${randomUUID()}@noreply.riskmodels.app`;
    const { data: createdUser, error: userError } =
      await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: {
          free_tier: true,
          agent_name,
          provisioned_via: "provision-free",
        },
      });
    if (userError || !createdUser?.user) {
      console.error("[Provision-Free] Auth user creation error:", userError);
      return NextResponse.json(
        {
          error: "Failed to create account",
          message: userError?.message || "Could not create free-tier user",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }
    const freeUserId = createdUser.user.id; // real UUID — satisfies the FK

    // Best-effort cleanup so a failed insert doesn't orphan the auth user.
    const rollbackUser = async () => {
      await supabase.auth.admin.deleteUser(freeUserId).catch(() => {});
    };

    // Generate API key
    const { plainKey, hashedKey, prefix } = generateApiKey();

    const affiliate = await findActiveAffiliateByCode(supabase, referralCodeRaw);
    const referralCodeForRow = affiliate
      ? affiliate.referral_code
      : referralCodeRaw;
    const referredByAffiliateId = affiliate?.id ?? null;

    // agent_id is UNIQUE NOT NULL — include the uuid so concurrent calls with
    // the same agent_name don't collide.
    const agentId = `free_${agent_name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 40)}_${freeUserId.slice(0, 12)}`;

    // Create free tier account (tier='free' is what bypasses the balance gate)
    const { error: accountError } = await supabase
      .from("agent_accounts")
      .insert({
        user_id: freeUserId,
        agent_id: agentId,
        agent_name,
        contact_email: syntheticEmail,
        balance_usd: FREE_TIER_LIMITS.INITIAL_BALANCE,
        tier: "free",
        status: "active",
        signup_attribution: { provisioned_via: "provision-free", ip, purpose },
        created_at: new Date().toISOString(),
      });

    if (accountError) {
      console.error("[Provision-Free] Account creation error:", accountError);
      await rollbackUser();
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
      referral_code: referralCodeForRow,
      referred_by_affiliate_id: referredByAffiliateId,
    });

    if (keyError) {
      console.error("[Provision-Free] Key storage error:", keyError);
      await rollbackUser();
      return NextResponse.json(
        {
          error: "Failed to store API key",
          message: keyError.message,
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }

    // Track free tier usage (free_tier_usage.user_id is TEXT — a uuid string
    // fits; checkFreeTierLimit also auto-creates this row, so it is non-fatal).
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
        message: "An unexpected error occurred. The incident has been logged.",
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
