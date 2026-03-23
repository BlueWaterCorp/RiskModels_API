/**
 * Free Tier Management
 *
 * Helpers for checking and updating free tier usage limits
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface FreeTierLimits {
  queries_per_day: number;
  queries_per_minute: number;
}

export const DEFAULT_FREE_LIMITS: FreeTierLimits = {
  queries_per_day: 100,
  queries_per_minute: 10,
};

export interface FreeTierStatus {
  user_id: string;
  tier: "free" | "paid" | "enterprise";
  queries_today: number;
  queries_this_month: number;
  remaining_today: number;
  rate_limit_per_minute: number;
  can_proceed: boolean;
  reason?: string;
}

/**
 * Check if user can proceed with a query based on free tier limits
 */
export async function checkFreeTierLimit(
  userId: string,
  limits: FreeTierLimits = DEFAULT_FREE_LIMITS,
): Promise<FreeTierStatus> {
  try {
    const supabase = createAdminClient();

    // Get account tier
    const { data: account } = await supabase
      .from("agent_accounts")
      .select("tier, rate_limit_per_minute")
      .eq("user_id", userId)
      .single();

    const tier = account?.tier || "paid";
    const rateLimit = account?.rate_limit_per_minute || 60;

    // If not free tier, allow unlimited
    if (tier !== "free") {
      return {
        user_id: userId,
        tier: tier as "free" | "paid" | "enterprise",
        queries_today: 0,
        queries_this_month: 0,
        remaining_today: Infinity,
        rate_limit_per_minute: rateLimit,
        can_proceed: true,
      };
    }

    // Get or create usage record
    const { data: usage, error } = await supabase
      .from("free_tier_usage")
      .select("queries_today, queries_this_month, reset_date")
      .eq("user_id", userId)
      .single();

    if (error || !usage) {
      // No usage record exists, create one
      const resetDate = new Date();
      resetDate.setHours(24, 0, 0, 0); // Next midnight UTC

      await supabase.from("free_tier_usage").insert({
        user_id: userId,
        queries_today: 0,
        queries_this_month: 0,
        reset_date: resetDate.toISOString(),
      });

      return {
        user_id: userId,
        tier: "free",
        queries_today: 0,
        queries_this_month: 0,
        remaining_today: limits.queries_per_day,
        rate_limit_per_minute: rateLimit,
        can_proceed: true,
      };
    }

    // Check if daily limit reached
    const queriesToday = usage.queries_today || 0;
    const remaining = limits.queries_per_day - queriesToday;

    if (remaining <= 0) {
      return {
        user_id: userId,
        tier: "free",
        queries_today: queriesToday,
        queries_this_month: usage.queries_this_month || 0,
        remaining_today: 0,
        rate_limit_per_minute: rateLimit,
        can_proceed: false,
        reason: `Daily limit reached: ${queriesToday}/${limits.queries_per_day} queries used. Limit resets at ${usage.reset_date}.`,
      };
    }

    return {
      user_id: userId,
      tier: "free",
      queries_today: queriesToday,
      queries_this_month: usage.queries_this_month || 0,
      remaining_today: remaining,
      rate_limit_per_minute: rateLimit,
      can_proceed: true,
    };
  } catch (error) {
    console.error("[FreeTier] Error checking limits:", error);
    // Fail open - allow request if we can't check
    return {
      user_id: userId,
      tier: "free",
      queries_today: 0,
      queries_this_month: 0,
      remaining_today: DEFAULT_FREE_LIMITS.queries_per_day,
      rate_limit_per_minute: 10,
      can_proceed: true,
      reason: "Error checking limits, allowing request",
    };
  }
}

/**
 * Increment free tier usage counters
 */
export async function incrementFreeTierUsage(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Use raw SQL to atomically increment or create the record
    const { error } = await createAdminClient().rpc("increment_free_tier_usage", {
      p_user_id: userId,
    });

    if (error) {
      console.error("[FreeTier] Error incrementing usage:", error);
      // Try fallback if RPC doesn't exist
      return incrementFreeTierUsageFallback(userId);
    }

    return { success: true };
  } catch (error) {
    console.error("[FreeTier] Error in incrementFreeTierUsage:", error);
    // Try fallback
    return incrementFreeTierUsageFallback(userId);
  }
}

/**
 * Fallback method that works without RPC
 */
async function incrementFreeTierUsageFallback(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient();

    // Check if record exists
    const { data: existing, error: selectError } = await supabase
      .from("free_tier_usage")
      .select("queries_today, queries_this_month, reset_date")
      .eq("user_id", userId)
      .single();

    const now = new Date().toISOString();
    const today = new Date();
    today.setHours(24, 0, 0, 0);

    if (!existing || selectError) {
      // Create new record
      const { error: insertError } = await supabase
        .from("free_tier_usage")
        .insert({
          user_id: userId,
          queries_today: 1,
          queries_this_month: 1,
          last_query_at: now,
          reset_date: today.toISOString(),
        });

      if (insertError) {
        console.error("[FreeTier] Error creating usage record:", insertError);
        return { success: false, error: insertError.message };
      }

      return { success: true };
    }

    // Update existing record
    const queriesToday = (existing.queries_today || 0) + 1;
    const queriesThisMonth = (existing.queries_this_month || 0) + 1;

    // Check if reset date is in the past
    const resetDate = new Date(existing.reset_date);
    let newResetDate = existing.reset_date;
    if (resetDate <= new Date()) {
      newResetDate = today.toISOString();
    }

    const { error: updateError } = await supabase
      .from("free_tier_usage")
      .update({
        queries_today: queriesToday,
        queries_this_month: queriesThisMonth,
        last_query_at: now,
        reset_date: newResetDate,
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("[FreeTier] Error updating usage record:", updateError);
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error) {
    console.error("[FreeTier] Error in fallback increment:", error);
    // Fail silently - don't block request if tracking fails
    return {
      success: true,
      error: "Failed to track usage (request still allowed)",
    };
  }
}

/**
 * Create RPC function to atomically increment usage
 */
export const CREATE_INCREMENT_RPC = `
CREATE OR REPLACE FUNCTION increment_free_tier_usage(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO free_tier_usage (
    user_id,
    queries_today,
    queries_this_month,
    last_query_at,
    reset_date
  )
  VALUES (
    p_user_id,
    1,
    1,
    NOW(),
    (CURRENT_DATE + INTERVAL '1 day')::timestamptz
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    queries_today = free_tier_usage.queries_today + 1,
    queries_this_month = free_tier_usage.queries_this_month + 1,
    last_query_at = NOW(),
    reset_date = CASE
      WHEN free_tier_usage.reset_date <= NOW()
      THEN (CURRENT_DATE + INTERVAL '1 day')::timestamptz
      ELSE free_tier_usage.reset_date
    END;
END;
$$ LANGUAGE plpgsql;
`;
