/**
 * Agent Billing System
 *
 * Handles per-request billing, balance management, and payment processing
 * for AI agent accounts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import Stripe from "stripe";
import {
  Capability,
  calculateRequestCost,
  getCapabilityById,
} from "./capabilities";

// Token conversion constant: $20 = 1M tokens
const TOKEN_PRICE_USD = 0.00002;
const STARTER_CREDIT_USD = 20;

// Lazy initialization to avoid build-time errors
let supabase: ReturnType<typeof createAdminClient> | null = null;

function getSupabase() {
  if (!supabase) {
    supabase = createAdminClient();
  }
  return supabase;
}

export interface BillingEvent {
  user_id: string;
  request_id: string;
  capability_id: string;
  cost_usd: number;
  latency_ms: number;
  success: boolean;
  metadata?: Record<string, any>;
}

export interface UserBalance {
  user_id: string;
  balance_usd: number;
  total_spent_usd: number;
  last_updated: string;
}

export interface BillingTransaction {
  id: string;
  user_id: string;
  type: "debit" | "credit" | "refund";
  amount_usd: number;
  balance_after_usd: number;
  description: string;
  metadata?: Record<string, any>;
  created_at: string;
}

/**
 * Get current user balance
 */
export async function getUserBalance(userId: string): Promise<number> {
  try {
    // First check agent_accounts table
    const { data: agentAccount } = await getSupabase()
      .from("agent_accounts")
      .select("balance_usd")
      .eq("user_id", userId)
      .single();

    if (agentAccount) {
      return parseFloat(agentAccount.balance_usd) || 0;
    }

    // Fallback to regular users (assume unlimited balance for now)
    const { data: user } = await getSupabase()
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (user) {
      // For existing users without agent accounts, return a high balance
      // This maintains backward compatibility during transition
      return 1000.0;
    }

    return 0;
  } catch (error) {
    console.error("[Billing] Error getting user balance:", error);
    throw new Error("Failed to retrieve user balance");
  }
}

/**
 * Check if user has sufficient balance for a request
 */
export async function checkBalance(
  userId: string,
  requiredAmount: number,
): Promise<{ sufficient: boolean; currentBalance: number; required: number }> {
  const currentBalance = await getUserBalance(userId);

  return {
    sufficient: currentBalance >= requiredAmount,
    currentBalance,
    required: requiredAmount,
  };
}

/**
 * Deduct balance atomically using the Supabase RPC `deduct_balance`.
 *
 * The RPC acquires a FOR UPDATE row lock, checks balance, and subtracts in a
 * single transaction — eliminating the race condition of the old
 * read-then-write pattern.  Returns `false` (insufficient funds) or `true`
 * (success).  Throws on unexpected DB errors.
 */
export async function deductBalance(
  userId: string,
  amountUsd: number,
  requestId: string,
  capabilityId: string,
  metadata?: Record<string, any>,
): Promise<void> {
  const client = getSupabase();

  // Atomic check-and-deduct via stored procedure (FOR UPDATE row lock)
  const { data: deducted, error: rpcError } = await client.rpc(
    "deduct_balance",
    { p_user_id: userId, p_amount: amountUsd } as any,
  );

  if (rpcError) {
    console.error("[Billing] RPC deduct_balance error:", rpcError);
    throw new Error(`Failed to deduct balance: ${rpcError.message}`);
  }

  if (!deducted) {
    // RPC returns false when balance is insufficient
    throw new Error("Insufficient balance");
  }

  // Read updated balance for the billing event and low-balance check
  const { data: account } = await client
    .from("agent_accounts")
    .select("balance_usd")
    .eq("user_id", userId)
    .single();

  const newBalance = account ? parseFloat(account.balance_usd) : 0;

  // Fire-and-forget low-balance notification (never blocks the request)
  getContactEmailForUser(userId)
    .then(({ email, name }) =>
      checkAndNotifyLowBalance(userId, newBalance, email, name),
    )
    .catch((e) => console.error("[Billing] Low balance check failed:", e));

  // Update monthly spend tracking
  try {
    await client.rpc("add_to_monthly_spend", {
      p_user_id: userId,
      p_amount: amountUsd,
    });
  } catch (monthlyError) {
    console.error("[Billing] Failed to update monthly spend:", monthlyError);
    // Don't block the request for monthly tracking failure
  }

  // Update daily spend tracking (UTC-day bucket, primary abuse guardrail).
  try {
    await client.rpc("add_to_daily_spend", {
      p_user_id: userId,
      p_amount: amountUsd,
    });
  } catch (dailyError) {
    console.error("[Billing] Failed to update daily spend:", dailyError);
    // Don't block the request for daily tracking failure
  }

  // Record billing event
  const { error: billingError } = await client.from("billing_events").insert({
    user_id: userId,
    request_id: requestId,
    capability_id: capabilityId,
    cost_usd: amountUsd,
    balance_after_usd: newBalance,
    type: "debit",
    description: `Request: ${capabilityId}`,
    metadata: metadata || {},
    created_at: new Date().toISOString(),
  });

  if (billingError) {
    // Log but don't fail - the balance was already deducted
    console.warn(
      `[Billing] Failed to insert billing event (column may not exist yet): ${billingError.message}`,
    );
    // Balance already deducted — telemetry loss is acceptable
    // rather than double-charging or failing the request.
  }

  console.log(
    `[Billing] Deducted $${amountUsd} from user ${userId}. New balance: $${newBalance}`,
  );
}

/**
 * Add credit to user balance (for top-ups, refunds, etc.)
 */
export async function addBalance(
  userId: string,
  amountUsd: number,
  description: string,
  metadata?: Record<string, any>,
  options?: { capabilityId?: string },
): Promise<void> {
  try {
    const client = getSupabase();
    const capabilityId = options?.capabilityId ?? "balance_credit";

    // Get current balance
    const { data: agentAccount } = await client
      .from("agent_accounts")
      .select("balance_usd")
      .eq("user_id", userId)
      .single();

    if (!agentAccount) {
      throw new Error("Agent account not found");
    }

    const currentBalance = parseFloat(agentAccount.balance_usd);
    const newBalance = currentBalance + amountUsd;

    // Update balance
    const { error: updateError } = await client
      .from("agent_accounts")
      .update({
        balance_usd: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      throw new Error(`Failed to update balance: ${updateError.message}`);
    }

    // Create billing event
    const { error: billingError } = await client.from("billing_events").insert({
      user_id: userId,
      request_id: `credit_${Date.now()}`,
      capability_id: capabilityId,
      cost_usd: -amountUsd, // Negative for credit
      balance_after_usd: newBalance,
      type: "credit",
      description,
      metadata: metadata || {},
      created_at: new Date().toISOString(),
    });

    if (billingError) {
      // Log but don't fail - the balance was already updated
      console.warn(
        `[Billing] Failed to create billing event (column may not exist yet): ${billingError.message}`,
      );
      // Continue - the money was added, just the audit trail is missing
    }

    console.log(
      `[Billing] Added $${amountUsd} to user ${userId}. New balance: $${newBalance}`,
    );
  } catch (error) {
    console.error("[Billing] Error adding balance:", error);
    throw error;
  }
}

/**
 * Ensure first-time developer users have starter credits.
 *
 * This only applies when the user has no agent account yet. We intentionally
 * avoid re-crediting existing accounts here.
 */
export async function ensureStarterCredits(userId: string): Promise<void> {
  const client = getSupabase();

  const { data: account } = await client
    .from("agent_accounts")
    .select("id, balance_usd")
    .eq("user_id", userId)
    .maybeSingle();

  // Existing account: only top up once for first-time users who ended up with 0 balance.
  if (account) {
    const currentBalance = parseFloat(account.balance_usd ?? 0);
    if (currentBalance > 0) return;

    const { data: priorStarterEvent } = await client
      .from("billing_events")
      .select("id")
      .eq("user_id", userId)
      .eq("capability_id", "starter_credit")
      .limit(1)
      .maybeSingle();

    // Already granted starter credit once; avoid repeated grants.
    if (priorStarterEvent) return;

    const toppedUpBalance = STARTER_CREDIT_USD;
    const { error: updateError } = await client
      .from("agent_accounts")
      .update({
        balance_usd: toppedUpBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      throw new Error(`Failed to top up starter balance: ${updateError.message}`);
    }

    const { error: billingError } = await client.from("billing_events").insert({
      user_id: userId,
      request_id: `starter_${Date.now()}`,
      capability_id: "starter_credit",
      cost_usd: -STARTER_CREDIT_USD,
      balance_after_usd: toppedUpBalance,
      type: "credit",
      description: "One-time starter credit top-up for existing dev account",
      metadata: { source: "first_time_existing_account_topup" },
      created_at: new Date().toISOString(),
    });

    if (billingError) {
      console.warn(
        `[Billing] Failed to log existing-account starter credit event: ${billingError.message}`,
      );
    }

    console.log(
      `[Billing] Granted one-time starter top-up ($${STARTER_CREDIT_USD}) to existing user ${userId}`,
    );
    return;
  }

  const { data: profile } = await client
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();

  const agentId = `starter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agentName = profile?.full_name || "API User";
  const contactEmail = profile?.email || `user-${userId.slice(0, 8)}@example.com`;

  const { error: createError } = await client.from("agent_accounts").insert({
    user_id: userId,
    agent_id: agentId,
    agent_name: agentName,
    contact_email: contactEmail,
    balance_usd: STARTER_CREDIT_USD,
    status: "active",
  });

  if (createError) {
    throw new Error(`Failed to create starter agent account: ${createError.message}`);
  }

  const { error: billingError } = await client.from("billing_events").insert({
    user_id: userId,
    request_id: `starter_${Date.now()}`,
    capability_id: "starter_credit",
    cost_usd: -STARTER_CREDIT_USD,
    balance_after_usd: STARTER_CREDIT_USD,
    type: "credit",
    description: "Starter credit for first-time developer account",
    metadata: { source: "first_time_auto_provision" },
    created_at: new Date().toISOString(),
  });

  if (billingError) {
    console.warn(
      `[Billing] Failed to log starter credit billing event: ${billingError.message}`,
    );
  }

  console.log(
    `[Billing] Provisioned starter credit ($${STARTER_CREDIT_USD}) for first-time user ${userId}`,
  );
}

const USER_KEY_FLOOR_CAPABILITY = "user_key_floor_credit";

/**
 * Holders of active `rm_user_*` keys use `user_generated_api_keys` + `agent_accounts`.
 * One-time top-up to {@link STARTER_CREDIT_USD} when balance is below that (deduped via billing_events).
 */
export async function ensureMinimumBalanceForUserKeyHolder(
  userId: string,
): Promise<void> {
  const client = getSupabase();

  const { data: keyRows } = await client
    .from("user_generated_api_keys")
    .select("id, expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .ilike("key_prefix", "rm_user%");

  const now = new Date();
  const hasActiveUserKey = (keyRows ?? []).some(
    (k) => !k.expires_at || new Date(k.expires_at) > now,
  );
  if (!hasActiveUserKey) return;

  await ensureStarterCredits(userId).catch(() => {});

  const { data: account } = await client
    .from("agent_accounts")
    .select("balance_usd")
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) return;

  const bal = parseFloat(String(account.balance_usd ?? 0));
  if (bal >= STARTER_CREDIT_USD) return;

  const { data: priorFloor } = await client
    .from("billing_events")
    .select("id")
    .eq("user_id", userId)
    .eq("capability_id", USER_KEY_FLOOR_CAPABILITY)
    .limit(1)
    .maybeSingle();

  if (priorFloor) return;

  const delta = STARTER_CREDIT_USD - bal;
  await addBalance(userId, delta, "Minimum balance for rm_user API key", {
    source: "user_key_floor_credit",
  }, { capabilityId: USER_KEY_FLOOR_CAPABILITY });
}

/**
 * Get billing history for a user
 */
export async function getBillingHistory(
  userId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<BillingTransaction[]> {
  try {
    const { data, error } = await getSupabase()
      .from("billing_events")
      .select(
        `
        id,
        user_id,
        request_id,
        capability_id,
        cost_usd,
        balance_after_usd,
        type,
        description,
        metadata,
        created_at
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to retrieve billing history: ${error.message}`);
    }

    const rows = data ?? [];
    return rows.map((row) => ({
      id: row.id as string,
      user_id: row.user_id as string,
      type: row.type as BillingTransaction["type"],
      amount_usd:
        typeof row.cost_usd === "number"
          ? row.cost_usd
          : parseFloat(String(row.cost_usd ?? 0)),
      balance_after_usd:
        typeof row.balance_after_usd === "number"
          ? row.balance_after_usd
          : parseFloat(String(row.balance_after_usd ?? 0)),
      description: (row.description as string) ?? "",
      metadata: row.metadata as Record<string, any> | undefined,
      created_at: row.created_at as string,
    }));
  } catch (error) {
    console.error("[Billing] Error getting billing history:", error);
    throw error;
  }
}

/**
 * Calculate cost for a request based on capability and usage
 */
export async function calculateRequestCostAsync(
  capabilityId: string,
  inputTokens?: number,
  outputTokens?: number,
  itemCount?: number,
): Promise<number> {
  const capability = getCapabilityById(capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} not found`);
  }

  return calculateRequestCost(
    capabilityId,
    inputTokens,
    outputTokens,
    itemCount,
  );
}

/**
 * Create agent account for existing user
 */
export async function createAgentAccount(
  userId: string,
  agentId: string,
  agentName: string,
  agentVersion?: string,
  contactEmail?: string,
  initialBalance: number = 0,
): Promise<void> {
  try {
    const { error } = await getSupabase().from("agent_accounts").insert({
      user_id: userId,
      agent_id: agentId,
      agent_name: agentName,
      agent_version: agentVersion,
      contact_email: contactEmail,
      balance_usd: initialBalance,
      total_spent_usd: 0,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to create agent account: ${error.message}`);
    }

    console.log(`[Billing] Created agent account for user ${userId}`);
  } catch (error) {
    console.error("[Billing] Error creating agent account:", error);
    throw error;
  }
}

/**
 * Create a top-up session for adding funds
 */
export async function createTopUp(
  userId: string,
  amountUsd: number,
  stripeCustomerId?: string,
): Promise<{
  session_id: string;
  payment_intent_client_secret?: string;
  amount_usd: number;
  status: "pending" | "completed" | "failed";
  success: boolean;
  error?: string;
}> {
  try {
    console.log(
      `[Billing] Creating top-up session for user ${userId}, amount: $${amountUsd}`,
    );

    const sessionId = `topup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Calculate tokens for metadata (automated ledger reconciliation)
    const tokenAmount = Math.floor(amountUsd / TOKEN_PRICE_USD);

    // Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn("[Billing] STRIPE_SECRET_KEY not configured, returning mock payment intent");
      // Mock payment intent for development
      const mockClientSecret = `pi_${Math.random().toString(36).substring(2, 24)}_secret_${Math.random().toString(36).substring(2, 24)}`;

      return {
        session_id: sessionId,
        payment_intent_client_secret: mockClientSecret,
        amount_usd: amountUsd,
        status: "pending",
        success: true,
      };
    }

    // Initialize Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Create PaymentIntent with metadata for automated ledger reconciliation
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amountUsd * 100), // Convert to cents
      currency: 'usd',
      customer: stripeCustomerId,
      metadata: {
        user_id: userId,
        token_amount: tokenAmount.toString(),
        top_up_id: sessionId,
        type: 'token_top_up',
        usd_amount: amountUsd.toString(),
        product_id: process.env.STRIPE_TOKENS_PRODUCT_ID || 'unknown',
      },
      description: `Token Top-up: ${tokenAmount.toLocaleString()} tokens ($${amountUsd})`,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(
      `[Billing] Created PaymentIntent ${paymentIntent.id} for user ${userId}, ${tokenAmount} tokens`,
    );

    // Record the pending top-up in the database
    const { error: insertError } = await getSupabase()
      .from('balance_top_ups')
      .insert({
        user_id: userId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_usd: amountUsd,
        status: 'pending',
        metadata: {
          token_amount: tokenAmount,
          session_id: sessionId,
        },
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('[Billing] Failed to record top-up:', insertError);
      // Don't fail the request, just log the error
    }

    return {
      session_id: sessionId,
      payment_intent_client_secret: paymentIntent.client_secret || undefined,
      amount_usd: amountUsd,
      status: "pending",
      success: true,
    };
  } catch (error) {
    console.error("[Billing] Error creating top-up session:", error);
    return {
      session_id: "",
      amount_usd: amountUsd,
      status: "failed",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get invoices for a user
 */
export async function getInvoices(
  userId: string,
  limit: number = 10,
  offset: number = 0,
): Promise<
  Array<{
    id: string;
    amount_usd: number;
    status: "paid" | "pending" | "failed";
    created_at: string;
    period_start: string;
    period_end: string;
    items: Array<{
      description: string;
      quantity: number;
      unit_price: number;
      total_price: number;
    }>;
  }>
> {
  try {
    // For now, return mock invoices
    // In production, this would integrate with Stripe or other billing systems

    console.log(`[Billing] Getting invoices for user ${userId}`);

    const mockInvoices = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: `inv_${Date.now()}_${i}`,
      amount_usd: Math.random() * 100 + 10,
      status: "paid" as const,
      created_at: new Date(
        Date.now() - i * 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      period_start: new Date(
        Date.now() - (i + 1) * 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      period_end: new Date(
        Date.now() - i * 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      items: [
        {
          description: "API Usage - Ticker Returns",
          quantity: Math.floor(Math.random() * 1000) + 100,
          unit_price: 0.005,
          total_price: Math.random() * 50 + 5,
        },
        {
          description: "API Usage - Risk Decomposition",
          quantity: Math.floor(Math.random() * 500) + 50,
          unit_price: 0.01,
          total_price: Math.random() * 30 + 3,
        },
      ],
    }));

    return mockInvoices;
  } catch (error) {
    console.error("[Billing] Error getting invoices:", error);
    throw error;
  }
}

/**
 * Get usage summary for invoices
 */
export async function getUsageSummary(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<{
  total_requests: number;
  total_cost: number;
  breakdown: Array<{
    capability_id: string;
    requests: number;
    cost: number;
    percentage: number;
  }>;
}> {
  try {
    const { data, error } = await getSupabase()
      .from("billing_events")
      .select(
        `
        capability_id,
        cost_usd,
        created_at
      `,
      )
      .eq("user_id", userId)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to retrieve usage summary: ${error.message}`);
    }

    const events = data || [];

    // Calculate totals and breakdown
    const totalRequests = events.length;
    const totalCost = events.reduce(
      (sum: number, event: any) => sum + parseFloat(event.cost_usd),
      0,
    );

    // Group by capability
    const capabilityBreakdown: Record<
      string,
      { requests: number; cost: number }
    > = {};
    events.forEach((event: any) => {
      const capId = event.capability_id;
      if (!capabilityBreakdown[capId]) {
        capabilityBreakdown[capId] = { requests: 0, cost: 0 };
      }
      capabilityBreakdown[capId].requests++;
      capabilityBreakdown[capId].cost += parseFloat(event.cost_usd);
    });

    const breakdown = Object.entries(capabilityBreakdown).map(
      ([capability_id, stats]) => ({
        capability_id,
        requests: stats.requests,
        cost: stats.cost,
        percentage: totalCost > 0 ? (stats.cost / totalCost) * 100 : 0,
      }),
    );

    return {
      total_requests: totalRequests,
      total_cost: totalCost,
      breakdown: breakdown.sort((a, b) => b.cost - a.cost),
    };
  } catch (error) {
    console.error("[Billing] Error getting usage summary:", error);
    throw error;
  }
}

/**
 * Get usage statistics for a user
 */
export async function getUsageStats(
  userId: string,
  days: number = 30,
): Promise<{
  total_requests: number;
  total_cost: number;
  average_cost_per_request: number;
  top_capabilities: Array<{
    capability_id: string;
    count: number;
    total_cost: number;
  }>;
}> {
  try {
    const startDate = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await getSupabase()
      .from("billing_events")
      .select(
        `
        capability_id,
        cost_usd,
        created_at
      `,
      )
      .eq("user_id", userId)
      .gte("created_at", startDate)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to retrieve usage stats: ${error.message}`);
    }

    const events = data || [];

    // Calculate totals
    const totalRequests = events.length;
    const totalCost = events.reduce(
      (sum: number, event: any) => sum + parseFloat(event.cost_usd),
      0,
    );
    const averageCostPerRequest =
      totalRequests > 0 ? totalCost / totalRequests : 0;

    // Group by capability
    const capabilityStats: Record<
      string,
      { count: number; total_cost: number }
    > = {};
    events.forEach((event: any) => {
      const capId = event.capability_id;
      if (!capabilityStats[capId]) {
        capabilityStats[capId] = { count: 0, total_cost: 0 };
      }
      capabilityStats[capId].count++;
      capabilityStats[capId].total_cost += parseFloat(event.cost_usd);
    });

    const topCapabilities = Object.entries(capabilityStats)
      .map(([capability_id, stats]) => ({
        capability_id,
        count: stats.count,
        total_cost: stats.total_cost,
      }))
      .sort((a, b) => b.total_cost - a.total_cost)
      .slice(0, 10);

    return {
      total_requests: totalRequests,
      total_cost: totalCost,
      average_cost_per_request: averageCostPerRequest,
      top_capabilities: topCapabilities,
    };
  } catch (error) {
    console.error("[Billing] Error getting usage stats:", error);
    throw error;
  }
}

// ── Low-balance alert ─────────────────────────────────────────────────────────

const LOW_BALANCE_THRESHOLD_USD = 5.0;

/**
 * Fetch the contact email and display name for an agent account.
 * Used by the low-balance alert to know where to send the email.
 */
async function getContactEmailForUser(
  userId: string,
): Promise<{ email: string; name: string }> {
  const { data } = await getSupabase()
    .from("agent_accounts")
    .select("contact_email, agent_name")
    .eq("user_id", userId)
    .single();
  return {
    email: data?.contact_email ?? "",
    name: data?.agent_name ?? "Developer",
  };
}

/**
 * Send a one-time low-balance alert email when balance drops below the threshold.
 * Deduplicated via `low_balance_notified_at` — only fires once per balance crossing.
 * The flag is reset by the Stripe webhook when a top-up completes.
 */
export async function checkAndNotifyLowBalance(
  userId: string,
  newBalance: number,
  contactEmail: string,
  userName: string,
): Promise<void> {
  if (newBalance >= LOW_BALANCE_THRESHOLD_USD || !contactEmail) return;

  const client = getSupabase();

  // Only send if we haven't already notified for this crossing
  const { data: account } = await client
    .from("agent_accounts")
    .select("low_balance_notified_at")
    .eq("user_id", userId)
    .single();

  if (account?.low_balance_notified_at) return;

  // Set the flag first to prevent duplicate sends under concurrent requests
  const { error: flagError } = await client
    .from("agent_accounts")
    .update({ low_balance_notified_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (flagError) {
    console.error("[Billing] Failed to set low_balance_notified_at:", flagError);
    return;
  }

  // Lazy import to avoid circular dependency (email-service imports billing indirectly)
  const { sendEmail } = await import("@/lib/email-service");
  const sent = await sendEmail({
    to: contactEmail,
    subject: "Your RiskModels API balance is running low",
    template: "low-balance",
    data: {
      userName,
      balanceUsd: newBalance,
      thresholdUsd: LOW_BALANCE_THRESHOLD_USD,
      topUpUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://riskmodels.net"}/settings/billing`,
    },
    userId,
  });

  if (!sent.success) {
    await client
      .from("agent_accounts")
      .update({ low_balance_notified_at: null })
      .eq("user_id", userId);
    console.error(
      "[Billing] Low-balance email failed; cleared notify flag for retry:",
      sent.error,
    );
    return;
  }

  console.log(
    `[Billing] Sent low-balance alert to ${contactEmail} (balance: $${newBalance.toFixed(4)})`,
  );
}
