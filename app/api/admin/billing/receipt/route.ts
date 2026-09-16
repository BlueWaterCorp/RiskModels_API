/**
 * POST /api/admin/billing/receipt
 *
 * Re-send (or backfill) the prepaid-credit receipt email for a Stripe
 * PaymentIntent that has already been credited to an account. Use it when:
 *  - the purchase pre-dates receipt emails (credited, never mailed);
 *  - the automatic send from /api/stripe/setup-success failed
 *    (`email_logs` row with status 'failed');
 *  - the customer asks for a copy.
 *
 * It never credits: the PaymentIntent must already have a `completed`
 * `balance_top_ups` row, which is where the amount and account come from.
 * The balance shown is the account's *current* balance, not the balance at
 * the time of the original credit, unless `balance_after_usd` is given.
 *
 * Auth: Authorization: Bearer CRON_SECRET (same machine-to-machine secret as
 * /api/admin/cache/*). Production value lives in Doppler `erm3/prd`:
 *
 *   doppler run -p erm3 -c prd -- bash -c \
 *     'curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *      -H "Content-Type: application/json" \
 *      -d "{\"payment_intent_id\":\"pi_…\"}" \
 *      "https://riskmodels.app/api/admin/billing/receipt"'
 *
 * Body: { payment_intent_id: string, to?: string, balance_after_usd?: number, dry_run?: boolean }
 *  - `to` overrides the recipient (default: agent_accounts.contact_email, else auth email).
 *  - `dry_run` returns the resolved receipt data without sending.
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPrepaidReceiptData,
  chargeFactsForPaymentIntent,
  sendPrepaidReceipt,
  type PrepaidReceiptInput,
} from "@/lib/agent/prepaid-receipt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorize(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

interface Body {
  payment_intent_id?: string;
  to?: string;
  balance_after_usd?: number;
  dry_run?: boolean;
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const paymentIntentId = body.payment_intent_id?.trim();
  if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
    return NextResponse.json({ error: "payment_intent_id (pi_…) required" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();

    const { data: topUp, error: topUpErr } = await admin
      .from("balance_top_ups")
      .select("user_id, amount_usd, status, created_at, metadata")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (topUpErr) {
      return NextResponse.json({ ok: false, error: topUpErr.message }, { status: 500 });
    }
    if (!topUp || topUp.status !== "completed") {
      return NextResponse.json(
        { ok: false, error: "no completed balance_top_ups row for that PaymentIntent — nothing to receipt" },
        { status: 404 },
      );
    }
    const userId = topUp.user_id as string;
    const amountUsd = parseFloat(String(topUp.amount_usd ?? 0));

    const { data: account } = await admin
      .from("agent_accounts")
      .select("contact_email, agent_name, balance_usd")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let to = body.to?.trim() || account?.contact_email?.trim() || "";
    if (!to.includes("@")) {
      const { data: authData } = await admin.auth.admin.getUserById(userId);
      to = authData?.user?.email ?? "";
    }
    if (!to.includes("@")) {
      return NextResponse.json({ ok: false, error: "no recipient email on file" }, { status: 422 });
    }

    const newBalanceUsd =
      typeof body.balance_after_usd === "number"
        ? body.balance_after_usd
        : parseFloat(String(account?.balance_usd ?? 0));

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json(
        { ok: false, error: `PaymentIntent status is ${paymentIntent.status}, not succeeded` },
        { status: 409 },
      );
    }
    const { billingName, ...facts } = await chargeFactsForPaymentIntent(stripe, paymentIntent);

    // Tax line comes from the Checkout session (PaymentIntents do not carry it).
    let taxUsd: number | undefined;
    const sessionId = (topUp.metadata as { session_id?: string } | null)?.session_id;
    if (sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const amountTax = session.total_details?.amount_tax;
        if (typeof amountTax === "number") taxUsd = amountTax / 100;
      } catch (e) {
        console.warn("[admin/billing/receipt] session lookup failed (no tax line):", e);
      }
    }

    const input: PrepaidReceiptInput = {
      userId,
      to,
      name: billingName ?? (account?.agent_name as string | undefined),
      amountUsd,
      taxUsd,
      newBalanceUsd,
      paymentIntentId,
      ...facts,
    };

    if (body.dry_run) {
      return NextResponse.json({ ok: true, dry_run: true, to, data: buildPrepaidReceiptData(input) });
    }

    const result = await sendPrepaidReceipt(input);
    if (!result.success) {
      return NextResponse.json({ ok: false, to, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, to, message_id: result.messageId, amount_usd: amountUsd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/billing/receipt]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
