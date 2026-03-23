/**
 * Agent Account Provisioning API
 *
 * Programmatically create an agent account in 3 simple steps:
 * 1. POST /api/auth/provision (this endpoint) → Get account + payment intent
 * 2. Complete payment with Stripe.js using client_secret
 * 3. Receive API key → Start making requests
 *
 * POST /api/auth/provision
 * Body: {
 *   agent_name: string,
 *   agent_version?: string,
 *   agent_id: string,
 *   contact_email: string,
 *   initial_deposit_usd?: number (default: 50, min: 10)
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/agent/api-keys";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

// Initialize Stripe if available
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse request body
    let body: {
      agent_name: string;
      agent_version?: string;
      agent_id: string;
      contact_email: string;
      initial_deposit_usd?: number;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: "Invalid request body",
          message: "Expected JSON body",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 400 },
      );
    }

    const {
      agent_name,
      agent_version = "1.0.0",
      agent_id,
      contact_email,
      initial_deposit_usd = 50,
    } = body;

    // Validate required fields
    if (!agent_name || !agent_id || !contact_email) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          message: "agent_name, agent_id, and contact_email are required",
          required_fields: ["agent_name", "agent_id", "contact_email"],
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 400 },
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contact_email)) {
      return NextResponse.json(
        {
          error: "Invalid email",
          message: "contact_email must be a valid email address",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 400 },
      );
    }

    // Validate initial deposit
    const deposit = Math.max(10, Math.min(10000, initial_deposit_usd));

    const supabase = createAdminClient();

    // Check if agent_id is already taken
    const { data: existingAgent } = await supabase
      .from("agent_accounts")
      .select("agent_id")
      .eq("agent_id", agent_id)
      .single();

    if (existingAgent) {
      return NextResponse.json(
        {
          error: "Agent ID already exists",
          message: `The agent_id '${agent_id}' is already registered. Please choose a unique identifier.`,
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 409 },
      );
    }

    // Generate a secure password for the auth user
    const password = generateSecurePassword();

    // Create Supabase auth user
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: contact_email,
        password,
        email_confirm: true,
        user_metadata: {
          agent_name,
          agent_version,
          agent_id,
          account_type: "agent",
          created_via: "api_provisioning",
        },
      });

    if (authError || !authUser) {
      console.error("[Provision] Auth error:", authError);
      return NextResponse.json(
        {
          error: "Failed to create account",
          message: authError?.message || "Authentication service error",
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }

    const userId = authUser.user.id;

    // Create agent account record
    const { error: accountError } = await supabase
      .from("agent_accounts")
      .insert({
        user_id: userId,
        agent_id,
        agent_name,
        agent_version,
        contact_email,
        balance_usd: 0,
        status: "active",
      });

    if (accountError) {
      console.error("[Provision] Account creation error:", accountError);
      // Clean up auth user
      await supabase.auth.admin.deleteUser(userId);

      return NextResponse.json(
        {
          error: "Failed to create agent account",
          message: accountError.message,
          _agent: { latency_ms: Date.now() - startTime },
        },
        { status: 500 },
      );
    }

    // Create profile
    await supabase.from("profiles").insert({
      id: userId,
      email: contact_email,
      full_name: agent_name,
      role: "user",
      subscription_tier: "agent_paygo",
    });

    // Generate API key
    const { plainKey, hashedKey, prefix } = generateApiKey();

    // Store hashed API key
    await supabase
      .from("agent_api_keys")
      .insert({
        user_id: userId,
        key_hash: hashedKey,
        key_prefix: prefix,
        name: "Default API Key",
        scopes: ["*"], // All capabilities
        rate_limit_per_minute: 60,
      });

    // Create Stripe payment intent if Stripe is configured
    let paymentData: {
      client_secret?: string;
      payment_intent_id?: string;
      status: string;
    } = { status: "stripe_not_configured" };

    if (stripe) {
      try {
        // Create Stripe customer
        const customer = await stripe.customers.create({
          email: contact_email,
          name: agent_name,
          metadata: {
            user_id: userId,
            agent_id,
            source: "agent_provisioning",
          },
        });

        // Update agent account with Stripe customer ID
        await supabase
          .from("agent_accounts")
          .update({ stripe_customer_id: customer.id })
          .eq("user_id", userId);

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(deposit * 100),
          currency: "usd",
          customer: customer.id,
          automatic_payment_methods: { enabled: true },
          metadata: {
            user_id: userId,
            agent_id,
            type: "initial_deposit",
          },
        });

        // Record the top-up
        await supabase.from("balance_top_ups").insert({
          user_id: userId,
          stripe_payment_intent_id: paymentIntent.id,
          amount_usd: deposit,
          status: "pending",
        });

        paymentData = {
          client_secret: paymentIntent.client_secret || undefined,
          payment_intent_id: paymentIntent.id,
          status: "requires_payment_method",
        };
      } catch (stripeError) {
        console.error("[Provision] Stripe error:", stripeError);
        // Continue without Stripe - user can add payment method later
        paymentData = { status: "stripe_error" };
      }
    }

    return NextResponse.json(
      {
        account: {
          user_id: userId,
          agent_id,
          agent_name,
          status: "pending_payment",
          created_at: new Date().toISOString(),
        },
        credentials: {
          api_key: plainKey, // ONLY SHOWN ONCE!
          prefix,
        },
        payment: {
          amount_usd: deposit,
          ...paymentData,
        },
        instructions: {
          next_steps: [
            "1. Store your API key securely (it will not be shown again)",
            "2. Complete the initial deposit using the client_secret",
            "3. Use your API key in the Authorization header: Bearer <api_key>",
            "4. Check your balance at /api/balance",
          ],
          warnings: [
            "Your API key is shown only once. If lost, you must generate a new one.",
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
    console.error("[Provision API] Error:", error);

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

/**
 * OPTIONS /api/auth/provision
 *
 * Handle CORS preflight requests.
 */
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

/**
 * Generate a secure random password
 */
function generateSecurePassword(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 32; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
