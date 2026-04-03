import { Resend } from "resend";
import { render } from "@react-email/render";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendResendEmail } from "@/lib/resend-audit";
import { WelcomeEmail } from "@/emails/welcome";
import { TrialEndingEmail } from "@/emails/trial-ending";
import { SubscriptionConfirmedEmail } from "@/emails/subscription-confirmed";
import { PaymentFailedEmail } from "@/emails/payment-failed";
import { UsageReportEmail } from "@/emails/usage-report";
import { MarketInsightsEmail } from "@/emails/market-insights";
import { LowBalanceEmail } from "@/emails/low-balance";
import { AutoRefillSuccessEmail } from "@/emails/auto-refill-success";
import { AutoRefillFailedEmail } from "@/emails/auto-refill-failed";
import { MonthlySpendResetEmail } from "@/emails/monthly-spend-reset";
import { DEFAULT_RESEND_FROM } from "@/emails/constants";

let supabase: ReturnType<typeof createAdminClient> | null = null;
function getSupabase() {
  if (!supabase) {
    supabase = createAdminClient();
  }
  return supabase;
}

function getResendClient() {
  return new Resend(process.env.RESEND_API_KEY || "");
}

export type EmailTemplate =
  | "welcome"
  | "trial-ending"
  | "subscription-confirmed"
  | "payment-failed"
  | "usage-report"
  | "market-insights"
  | "low-balance"
  | "auto-refill-success"
  | "auto-refill-failed"
  | "monthly-spend-reset";

interface EmailData {
  welcome: {
    userName: string;
    dashboardUrl: string;
  };
  "trial-ending": {
    userName: string;
    trialEndsAt: string;
    upgradeUrl: string;
  };
  "subscription-confirmed": {
    userName: string;
    tier: string;
    amount: number;
    nextBillingDate: string;
    invoiceUrl: string;
  };
  "payment-failed": {
    userName: string;
    amount: number;
    updatePaymentUrl: string;
    gracePeriodDays: number;
  };
  "usage-report": {
    userName: string;
    month: string;
    portfolioValue: number;
    hedgesExecuted: number;
    riskReduction: number;
    topHoldings: Array<{ ticker: string; value: number; risk: number }>;
  };
  "market-insights": {
    userName: string;
    week: string;
    marketVolatility: number;
    topRisks: Array<{ sector: string; exposure: number }>;
    recommendedHedges: Array<{ ticker: string; hedgeRatio: number; etf: string }>;
  };
  "low-balance": {
    userName: string;
    balanceUsd: number;
    thresholdUsd: number;
    topUpUrl: string;
  };
  "auto-refill-success": {
    userName: string;
    amountUsd: number;
    tokenAmount: number;
    newBalance: number;
    paymentIntentId: string;
    topUpUrl: string;
  };
  "auto-refill-failed": {
    userName: string;
    errorMessage: string;
    balanceUsd: number;
    updatePaymentUrl: string;
  };
  "monthly-spend-reset": {
    monthName: string;
    year: number;
    settingsUrl: string;
  };
}

/** Default outbound From when `RESEND_FROM_EMAIL` is unset (re-export for callers). */
export const DEFAULT_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_RESEND_FROM;

export async function sendEmail<T extends EmailTemplate>({
  to,
  subject,
  template,
  data,
  userId,
}: {
  to: string;
  subject: string;
  template: T;
  data: EmailData[T];
  userId?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    const msg = "RESEND_API_KEY not configured";
    console.warn(`[email-service] ${msg}; email not sent (${template} → ${to})`);
    return { success: false, error: msg };
  }

  try {
    let emailHtml: string;

    switch (template) {
      case "welcome":
        emailHtml = await render(WelcomeEmail(data as EmailData["welcome"]));
        break;
      case "trial-ending":
        emailHtml = await render(TrialEndingEmail(data as EmailData["trial-ending"]));
        break;
      case "subscription-confirmed":
        emailHtml = await render(
          SubscriptionConfirmedEmail(data as EmailData["subscription-confirmed"]),
        );
        break;
      case "payment-failed":
        emailHtml = await render(PaymentFailedEmail(data as EmailData["payment-failed"]));
        break;
      case "usage-report":
        emailHtml = await render(UsageReportEmail(data as EmailData["usage-report"]));
        break;
      case "market-insights":
        emailHtml = await render(MarketInsightsEmail(data as EmailData["market-insights"]));
        break;
      case "low-balance":
        emailHtml = await render(LowBalanceEmail(data as EmailData["low-balance"]));
        break;
      case "auto-refill-success":
        emailHtml = await render(
          AutoRefillSuccessEmail(data as EmailData["auto-refill-success"]),
        );
        break;
      case "auto-refill-failed":
        emailHtml = await render(
          AutoRefillFailedEmail(data as EmailData["auto-refill-failed"]),
        );
        break;
      case "monthly-spend-reset":
        emailHtml = await render(
          MonthlySpendResetEmail(data as EmailData["monthly-spend-reset"]),
        );
        break;
      default: {
        const _exhaustive: never = template;
        throw new Error(`Unknown email template: ${_exhaustive}`);
      }
    }

    const fromEmail =
      process.env.RESEND_FROM_EMAIL?.trim() ||
      (process.env.NODE_ENV === "production"
        ? DEFAULT_RESEND_FROM
        : "RiskModels <onboarding@resend.dev>");

    const resend = getResendClient();
    const sent = await sendResendEmail(resend, {
      from: fromEmail,
      to,
      subject,
      html: emailHtml,
    });
    const messageId = sent.id;

    if (userId) {
      await logEmail({
        userId,
        emailType: template,
        recipientEmail: to,
        subject,
        status: "sent",
        providerMessageId: messageId,
      });
    }

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error("Error sending email:", error);

    if (userId) {
      await logEmail({
        userId,
        emailType: template,
        recipientEmail: to,
        subject,
        status: "failed",
        metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

async function logEmail({
  userId,
  emailType,
  recipientEmail,
  subject,
  status,
  providerMessageId,
  metadata,
}: {
  userId: string;
  emailType: string;
  recipientEmail: string;
  subject: string;
  status: string;
  providerMessageId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await getSupabase().from("email_logs").insert({
      user_id: userId,
      email_type: emailType,
      recipient_email: recipientEmail,
      subject,
      status,
      provider_message_id: providerMessageId,
      metadata,
    });
  } catch (err) {
    console.error("Error logging email:", err);
  }
}

export async function trackEmailOpen(messageId: string) {
  try {
    await getSupabase()
      .from("email_logs")
      .update({ opened_at: new Date().toISOString() })
      .eq("provider_message_id", messageId);
  } catch (error) {
    console.error("Error tracking email open:", error);
  }
}

export async function trackEmailClick(messageId: string) {
  try {
    await getSupabase()
      .from("email_logs")
      .update({ clicked_at: new Date().toISOString() })
      .eq("provider_message_id", messageId);
  } catch (error) {
    console.error("Error tracking email click:", error);
  }
}
