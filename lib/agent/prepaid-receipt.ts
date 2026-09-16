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
  /** Display name; falls back to the email local-part. */
  name?: string | null;
  amountUsd: number;
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

export function displayNameFor(name: string | null | undefined, email: string): string {
  const n = name?.trim();
  if (n && !n.includes("@")) return n;
  const local = email.split("@")[0] ?? "";
  return local || "Developer";
}

export function prepaidReceiptSubject(amountUsd: number): string {
  return `Receipt: $${amountUsd.toFixed(2)} RiskModels API credit`;
}

/** Template props for the receipt — pure, so tests and previews can build it without Stripe. */
export function buildPrepaidReceiptData(input: PrepaidReceiptInput) {
  return {
    firstName: displayNameFor(input.name, input.to),
    amountUsd: input.amountUsd,
    newBalanceUsd: input.newBalanceUsd,
    paymentIntentId: input.paymentIntentId,
    paidAtFormatted: formatPaidAt(input.paidAt),
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
  const result = await sendEmail({
    to: input.to,
    subject: prepaidReceiptSubject(input.amountUsd),
    template: "prepaid-receipt",
    data: buildPrepaidReceiptData(input),
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
