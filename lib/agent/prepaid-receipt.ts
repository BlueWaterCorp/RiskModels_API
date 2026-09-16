/**
 * Prepaid-credit receipt email.
 *
 * One entry point, two callers:
 *  - `/api/stripe/setup-success` — right after a Checkout payment is credited
 *    (once per PaymentIntent; the caller's idempotency guard on
 *    `balance_top_ups` is what keeps this to a single send).
 *  - `/api/admin/billing/receipt` — operator re-send / backfill for a
 *    PaymentIntent that was credited before receipts existed, or whose
 *    original send failed (`email_logs.status = 'failed'`).
 *
 * Stripe's hosted receipt (`charge.receipt_url`) carries the legal entity,
 * card and tax lines; this mail links it and adds the account-side facts
 * Stripe cannot know — the balance after credit.
 */
import type Stripe from "stripe";
import { getAppUrl } from "@/lib/app-url";

export interface PrepaidReceiptInput {
  userId: string;
  to: string;
  /** Billing name from the card / account; email-shaped values are dropped. */
  name?: string | null;
  amountUsd: number;
  /** Tax collected, USD; omit when unknown (no tax line is shown). */
  taxUsd?: number;
  newBalanceUsd: number;
  paymentIntentId: string;
  /** Unix seconds (Stripe `created`) or ISO string. */
  paidAt: number | string;
  paymentMethodLabel?: string;
  receiptUrl?: string;
}

export interface ChargeReceiptFacts {
  paidAt: number;
  receiptUrl?: string;
  paymentMethodLabel?: string;
  /** `billing_details.name` on the charge, when the buyer gave one. */
  billingName?: string;
}

const BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

/** "Visa •••• 4242" / "Link" / "Bank account •••• 6789" — undefined when nothing usable. */
export function paymentMethodLabelFromCharge(
  details: Stripe.Charge.PaymentMethodDetails | null | undefined,
): string | undefined {
  if (!details) return undefined;
  const card = details.card;
  if (card?.last4) {
    const brand = card.brand ? (BRAND_LABEL[card.brand] ?? card.brand) : "Card";
    return `${brand} •••• ${card.last4}`;
  }
  if (details.type === "link") return "Link";
  if (details.us_bank_account?.last4) {
    return `Bank account •••• ${details.us_bank_account.last4}`;
  }
  if (details.type) return details.type.replace(/_/g, " ");
  return undefined;
}

/**
 * Pull the receipt facts for a PaymentIntent from its latest charge.
 * Never throws — a receipt without the Stripe link is still worth sending.
 */
export async function chargeFactsForPaymentIntent(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
): Promise<ChargeReceiptFacts> {
  const facts: ChargeReceiptFacts = { paidAt: paymentIntent.created };
  try {
    const latest = paymentIntent.latest_charge;
    const charge: Stripe.Charge | null =
      latest && typeof latest !== "string"
        ? latest
        : latest
          ? await stripe.charges.retrieve(latest)
          : null;
    if (!charge) return facts;
    if (charge.created) facts.paidAt = charge.created;
    if (charge.receipt_url) facts.receiptUrl = charge.receipt_url;
    const label = paymentMethodLabelFromCharge(charge.payment_method_details);
    if (label) facts.paymentMethodLabel = label;
    const billingName = charge.billing_details?.name?.trim();
    if (billingName) facts.billingName = billingName;
  } catch (err) {
    console.warn("[prepaid-receipt] charge lookup failed (sending without Stripe link):", err);
  }
  return facts;
}

export function formatPaidAt(paidAt: number | string): string {
  const d = typeof paidAt === "number" ? new Date(paidAt * 1000) : new Date(paidAt);
  if (Number.isNaN(d.getTime())) return String(paidAt);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A billing name worth printing: non-empty and not just the email address. */
export function billedToNameFor(name: string | null | undefined): string | undefined {
  const n = name?.trim();
  if (!n || n.includes("@")) return undefined;
  return n;
}

/**
 * Receipt number: RM-<UTC yyyymmdd>-<last 6 of the PaymentIntent, upper-cased>.
 * Deterministic, so a re-send reproduces the number on the original.
 */
export function receiptNumberFor(paymentIntentId: string, paidAt: number | string): string {
  const d = typeof paidAt === "number" ? new Date(paidAt * 1000) : new Date(paidAt);
  const ymd = Number.isNaN(d.getTime())
    ? "00000000"
    : d.toISOString().slice(0, 10).replace(/-/g, "");
  const tail = paymentIntentId.replace(/^pi_/, "").slice(-6).toUpperCase().padStart(6, "0");
  return `RM-${ymd}-${tail}`;
}

export function prepaidReceiptSubject(amountUsd: number, receiptNumber: string): string {
  return `Receipt ${receiptNumber}: $${amountUsd.toFixed(2)} RiskModels API credit`;
}

/** Template props for the receipt — pure, so tests and previews can build it without Stripe. */
export function buildPrepaidReceiptData(input: PrepaidReceiptInput) {
  return {
    receiptNumber: receiptNumberFor(input.paymentIntentId, input.paidAt),
    paidAtFormatted: formatPaidAt(input.paidAt),
    billedToName: billedToNameFor(input.name),
    billedToEmail: input.to,
    amountUsd: input.amountUsd,
    taxUsd: input.taxUsd,
    newBalanceUsd: input.newBalanceUsd,
    paymentIntentId: input.paymentIntentId,
    paymentMethodLabel: input.paymentMethodLabel,
    receiptUrl: input.receiptUrl,
    balanceUrl: `${getAppUrl()}/get-key`,
  };
}

export async function sendPrepaidReceipt(
  input: PrepaidReceiptInput,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!input.to || !input.to.includes("@")) {
    return { success: false, error: "no recipient email" };
  }
  if (!(input.amountUsd > 0)) {
    return { success: false, error: "amount must be positive" };
  }
  // Lazy import: email-service pulls in every template; keep the Stripe route light.
  const { sendEmail } = await import("@/lib/email-service");
  const data = buildPrepaidReceiptData(input);
  const result = await sendEmail({
    to: input.to,
    subject: prepaidReceiptSubject(input.amountUsd, data.receiptNumber),
    template: "prepaid-receipt",
    data,
    userId: input.userId,
  });
  if (result.success) {
    console.log(
      `[prepaid-receipt] sent to ${input.to} for ${input.paymentIntentId} ($${input.amountUsd.toFixed(2)})`,
    );
  } else {
    console.error(
      `[prepaid-receipt] failed for ${input.paymentIntentId}:`,
      result.error ?? "unknown",
    );
  }
  return result;
}
