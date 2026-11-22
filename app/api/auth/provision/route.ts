/**
 * Agent Account Provisioning API
 *
 * One unauthenticated POST returns a working API key. No browser, no captcha.
 *
 * POST /api/auth/provision
 * Body: {
 *   agent_name: string,
 *   agent_id: string,            // caller-chosen unique id
 *   contact_email: string,       // unverified until its owner confirms
 *   agent_version?: string,
 *   initial_deposit_usd?: number (default: 50, min: 10)
 * }
 *
 * What it does, and why:
 *   - The auth user is created under a synthetic address
 *     (`agent+<uuid>@noreply.riskmodels.app`), as provision-free does. It is
 *     never created under `contact_email`: doing that with `email_confirm:
 *     true` let anyone pre-register an account for an address they do not own
 *     and hold a key to it before the owner ever signed in.
 *   - `contact_email` is stored as an unverified contact. Its owner gets a
 *     "confirm your email" link. Until they confirm, the key runs at the
 *     provision-free limits (free tier: 100 requests/day, 10/minute). After,
 *     the account moves to the paid tier (see lib/agent/provision-claim.ts).
 *   - Nothing here looks up, attaches to, or returns a key for an existing
 *     account, whatever address is supplied.
 *   - Rate limited per IP, shared with provision-free, failing closed.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/agent/api-keys";
import { sendEmail } from "@/lib/email-service";
import { ACCOUNT_CLAIM_SUBJECT } from "@/emails/account-claim";
import { BASE_URL } from "@/emails/constants";
import {
  FREE_TIER_RPM,
  contactEmailHash,
  generateSecurePassword,
  newClaimToken,
  normalizeContactEmail,
  syntheticAgentEmail,
} from "@/lib/agent/provision-claim";
import {
  checkClaimEmailAllowance,
  checkProvisionRateLimit,
  provisionClientIp,
  provisionRateLimitBody,
  recentProvisionsFromIp,
} from "@/lib/agent/provision-rate-limit";
import { SIGNUP_SITE } from "@/lib/auth/signup-site";

export const dynamic = "force-dynamic";

const FREE_TIER_QUERIES_PER_DAY = 100;
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/;

// Initialize Stripe if available
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v.length <= max ? v : null;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const latency = () => ({ latency_ms: Date.now() - startTime });

  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body", _agent: latency() },
        { status: 400 },
      );
    }

    const agent_name = str(body.agent_name, 100);
    const agent_id = str(body.agent_id, 100);
    const agent_version = str(body.agent_version, 40) ?? "1.0.0";
    const contactRaw = str(body.contact_email, 254);

    if (!agent_name || !agent_id || !contactRaw) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          message: "agent_name, agent_id, and contact_email are required strings",
          required_fields: ["agent_name", "agent_id", "contact_email"],
          _agent: latency(),
        },
        { status: 400 },
      );
    }
    if (!AGENT_ID_RE.test(agent_id)) {
      return NextResponse.json(
        {
          error: "Invalid agent_id",
          message: "agent_id must be 3-100 characters: letters, digits, '.', '_', ':' or '-', starting with a letter or digit",
          _agent: latency(),
        },
        { status: 400 },
      );
    }
    const contact_email = normalizeContactEmail(contactRaw);
    if (!contact_email) {
      return NextResponse.json(
        { error: "Invalid email", message: "contact_email must be a valid email address", _agent: latency() },
        { status: 400 },
      );
    }

    const depositRaw = typeof body.initial_deposit_usd === "number" && Number.isFinite(body.initial_deposit_usd)
      ? body.initial_deposit_usd
      : 50;
    const deposit = Math.max(10, Math.min(10000, depositRaw));

    // --- Rate limit (fails closed; see lib/agent/provision-rate-limit.ts) ---
    const ip = provisionClientIp(request.headers);
    const rl = await checkProvisionRateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(provisionRateLimitBody(rl, Date.now() - startTime), {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      });
    }

    const supabase = createAdminClient();

    const ipCap = await recentProvisionsFromIp(supabase, ip);
    if (ipCap === "unavailable") {
      return NextResponse.json(
        {
          error: "Provisioning temporarily unavailable",
          message: "Could not check the provisioning limit. Retry shortly.",
          _agent: { action: "retry", retry_after_seconds: 60, ...latency() },
        },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    if (ipCap === "capped") {
      return NextResponse.json(
        provisionRateLimitBody({ ...rl, ok: false, mode: "per_ip", retryAfterSec: 3600 }, Date.now() - startTime),
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    // Check if agent_id is already taken
    const { data: existingAgent, error: existingErr } = await supabase
      .from("agent_accounts")
      .select("agent_id")
      .eq("agent_id", agent_id)
      .maybeSingle();

    if (existingErr) {
      console.error("[Provision] agent_id lookup error:", existingErr.message);
      return NextResponse.json(
        { error: "Failed to create account", message: "Could not check agent_id", _agent: latency() },
        { status: 500 },
      );
    }
    if (existingAgent) {
      return NextResponse.json(
        {
          error: "Agent ID already exists",
          message: `The agent_id '${agent_id}' is already registered. Please choose a unique identifier.`,
          _agent: latency(),
        },
        { status: 409 },
      );
    }

    // Auth user under a synthetic address. The supplied contact_email is never
    // an auth identity here, so this cannot collide with, pre-register, or
    // reach an existing account that uses that address.
    const syntheticEmail = syntheticAgentEmail("agent");
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: syntheticEmail,
        password: generateSecurePassword(),
        email_confirm: true,
        user_metadata: {
          agent_name,
          agent_version,
          agent_id,
          account_type: "agent",
          created_via: "api_provisioning",
          provisioned_via: "provision",
        },
        app_metadata: { signup_site: SIGNUP_SITE },
      });

    if (authError || !authUser?.user) {
      console.error("[Provision] Auth error:", authError?.message);
      return NextResponse.json(
        { error: "Failed to create account", message: "Authentication service error", _agent: latency() },
        { status: 500 },
      );
    }

    const userId = authUser.user.id;
    const rollbackUser = async () => {
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
    };

    const claim = newClaimToken();

    // tier='free' is what applies the provision-free limits until the contact
    // address is confirmed.
    const { error: accountError } = await supabase
      .from("agent_accounts")
      .insert({
        user_id: userId,
        agent_id,
        agent_name,
        agent_version,
        contact_email: syntheticEmail,
        balance_usd: 0,
        tier: "free",
        status: "active",
        signup_attribution: {
          provisioned_via: "provision",
          ip,
          unverified_contact_email: contact_email,
          claim_status: "pending",
          claim_token_hash: claim.tokenHash,
          claim_expires_at: claim.expiresAt,
        },
      });

    if (accountError) {
      console.error("[Provision] Account creation error:", accountError.message);
      await rollbackUser();
      // 23505: agent_id (or user_id) unique violation from a concurrent call.
      const conflict = (accountError as { code?: string }).code === "23505";
      return NextResponse.json(
        conflict
          ? {
              error: "Agent ID already exists",
              message: `The agent_id '${agent_id}' is already registered. Please choose a unique identifier.`,
              _agent: latency(),
            }
          : { error: "Failed to create agent account", message: "Could not create the account", _agent: latency() },
        { status: conflict ? 409 : 500 },
      );
    }

    // Best-effort profile row (a trigger may already have created it).
    await supabase.from("profiles").insert({
      id: userId,
      email: syntheticEmail,
      full_name: agent_name,
      role: "user",
      subscription_tier: "agent_paygo",
    });

    const { plainKey, hashedKey, prefix } = generateApiKey();

    const { error: keyError } = await supabase
      .from("agent_api_keys")
      .insert({
        user_id: userId,
        key_hash: hashedKey,
        key_prefix: prefix,
        name: "Default API Key",
        scopes: ["*"], // All capabilities
        rate_limit_per_minute: FREE_TIER_RPM,
      });

    if (keyError) {
      console.error("[Provision] Key storage error:", keyError.message);
      await supabase.from("agent_accounts").delete().eq("user_id", userId);
      await rollbackUser();
      return NextResponse.json(
        { error: "Failed to store API key", message: "Could not create the key", _agent: latency() },
        { status: 500 },
      );
    }

    // Non-fatal: checkFreeTierLimit creates this row on first use if absent.
    const { error: usageError } = await supabase.from("free_tier_usage").insert({
      user_id: userId,
      queries_today: 0,
      queries_this_month: 0,
      last_query_at: null,
      reset_date: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
    });
    if (usageError) console.error("[Provision] Usage tracking error:", usageError.message);

    // Claim email to the supplied address: at most one per address per day.
    let claimEmail: "sent" | "not_sent_rate_limited" | "not_sent_error" = "not_sent_rate_limited";
    if (await checkClaimEmailAllowance(contactEmailHash(contact_email))) {
      const sent = await sendEmail({
        to: contact_email,
        subject: ACCOUNT_CLAIM_SUBJECT,
        template: "account-claim",
        data: {
          agentName: agent_name,
          claimUrl: `${BASE_URL}/api/auth/provision/claim?token=${encodeURIComponent(claim.token)}`,
          expiresAtFormatted: new Date(claim.expiresAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }),
        },
      }).catch(() => ({ success: false as const }));
      claimEmail = sent.success ? "sent" : "not_sent_error";
    }

    // Create Stripe payment intent if Stripe is configured
    let paymentData: {
      client_secret?: string;
      payment_intent_id?: string;
      status: string;
    } = { status: "stripe_not_configured" };

    if (stripe) {
      try {
        // The contact address is unverified, so it is metadata only: Stripe
        // must not treat it as the customer's email (receipts, lookups).
        const customer = await stripe.customers.create({
          name: agent_name,
          metadata: {
            user_id: userId,
            agent_id,
            source: "agent_provisioning",
            contact_email_unverified: contact_email,
          },
        });

        await supabase
          .from("agent_accounts")
          .update({ stripe_customer_id: customer.id })
          .eq("user_id", userId);

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
        console.error("[Provision] Stripe error:", stripeError instanceof Error ? stripeError.message : stripeError);
        // Continue without Stripe: the key works without a deposit.
        paymentData = { status: "stripe_error" };
      }
    }

    return NextResponse.json(
      {
        account: {
          user_id: userId,
          agent_id,
          agent_name,
          status: "active",
          tier: "free",
          contact_email_status: "unverified",
          limits: {
            queries_per_day: FREE_TIER_QUERIES_PER_DAY,
            queries_per_minute: FREE_TIER_RPM,
          },
          created_at: new Date().toISOString(),
        },
        credentials: {
          api_key: plainKey, // ONLY SHOWN ONCE!
          prefix,
        },
        claim: {
          email: claimEmail,
          expires_at: claim.expiresAt,
          effect:
            "When the owner of contact_email confirms from the emailed link, the account leaves the free-tier limits (60 requests/minute, no daily cap) and carries the one-time $20 starter credit.",
        },
        payment: {
          optional: true,
          amount_usd: deposit,
          ...paymentData,
        },
        instructions: {
          next_steps: [
            "1. Store your API key securely (it will not be shown again)",
            "2. Use your API key now in the Authorization header: Bearer <api_key>",
            "3. Confirm with GET /api/metrics/AAPL and quote l3 residual explained-risk from the JSON",
            "4. Ask the owner of contact_email to confirm from the emailed link to lift the free-tier limits",
            "5. Check usage at /api/auth/free-tier-status and balance at /api/balance",
          ],
          warnings: [
            "Your API key is shown only once. If lost, you must generate a new one.",
            "Until contact_email is confirmed the key is limited to 100 requests/day and 10/minute.",
            "This call never returns a key for an existing account, whatever contact_email is supplied.",
          ],
        },
        _agent: latency(),
      },
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[Provision API] Error:", error instanceof Error ? error.message : error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred. The incident has been logged.",
        _agent: latency(),
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
