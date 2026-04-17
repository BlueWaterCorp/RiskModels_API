/**
 * Daily cron: email users when an API key is 14, 7, or 1 day(s) from expires_at.
 * Deduped via agent_api_keys.expiry_notified_*_at columns.
 *
 * Email path matches BWMACRO / portal flow: Resend + React Email via lib/email-service.sendEmail
 * (same as low-balance alerts).
 */

import { createAdminClient } from "@/lib/supabase/admin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://riskmodels.app";

export type ExpiryMilestone = 14 | 7 | 1;

function daysUntilExpiry(expiresAtIso: string, now: Date): number {
  const end = new Date(expiresAtIso).getTime();
  return Math.floor((end - now.getTime()) / 86_400_000);
}

function milestoneForDaysLeft(daysLeft: number): ExpiryMilestone | null {
  if (daysLeft === 14 || daysLeft === 7 || daysLeft === 1) return daysLeft;
  return null;
}

export function formatExpiresAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

/** Shared with transactional mail (e.g. key issued) — same resolution order as expiry reminders. */
export async function resolveRecipient(
  userId: string,
): Promise<{ email: string; name: string } | null> {
  const admin = createAdminClient();

  const { data: account } = await admin
    .from("agent_accounts")
    .select("contact_email, agent_name")
    .eq("user_id", userId)
    .maybeSingle();

  const contact = account?.contact_email?.trim();
  if (contact && contact.includes("@")) {
    return {
      email: contact,
      name: (account?.agent_name as string)?.trim() || "Developer",
    };
  }

  const { data: authData, error } = await admin.auth.admin.getUserById(userId);
  if (error || !authData.user?.email) return null;
  const email = authData.user.email;
  const meta = authData.user.user_metadata as Record<string, unknown> | undefined;
  const fullName = typeof meta?.full_name === "string" ? meta.full_name : null;
  return {
    email,
    name: fullName?.trim() || email.split("@")[0] || "Developer",
  };
}

function notifiedColumn(
  m: ExpiryMilestone,
): "expiry_notified_14d_at" | "expiry_notified_7d_at" | "expiry_notified_1d_at" {
  if (m === 14) return "expiry_notified_14d_at";
  if (m === 7) return "expiry_notified_7d_at";
  return "expiry_notified_1d_at";
}

export async function runNotifyExpiringApiKeys(): Promise<{
  sent: number;
  skipped: number;
  errors: string[];
}> {
  const { sendEmail } = await import("@/lib/email-service");
  const admin = createAdminClient();
  const now = new Date();

  const { data: rows, error } = await admin
    .from("agent_api_keys")
    .select(
      "id, user_id, name, key_prefix, expires_at, expiry_notified_14d_at, expiry_notified_7d_at, expiry_notified_1d_at",
    )
    .is("revoked_at", null)
    .not("expires_at", "is", null)
    .gt("expires_at", now.toISOString());

  if (error) {
    return {
      sent: 0,
      skipped: 0,
      errors: [`query agent_api_keys: ${error.message}`],
    };
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows ?? []) {
    const expiresAt = row.expires_at as string;
    const daysLeft = daysUntilExpiry(expiresAt, now);
    const milestone = milestoneForDaysLeft(daysLeft);
    if (!milestone) {
      skipped++;
      continue;
    }

    const col = notifiedColumn(milestone);
    const flags = row as Record<string, unknown>;
    if (flags[col]) {
      skipped++;
      continue;
    }

    const recipient = await resolveRecipient(row.user_id as string);
    if (!recipient?.email) {
      errors.push(`key ${row.id}: no email for user ${row.user_id}`);
      skipped++;
      continue;
    }

    const keyName = (row.name as string)?.trim() || "API key";
    const keyPrefix = (row.key_prefix as string)?.trim() || "rm_agent_";

    const result = await sendEmail({
      to: recipient.email,
      subject: `RiskModels: API key expires in ${milestone} day${milestone === 1 ? "" : "s"}`,
      template: "key-expiring",
      data: {
        userName: recipient.name,
        keyName,
        keyPrefix,
        expiresAtFormatted: formatExpiresAt(expiresAt),
        daysRemaining: milestone,
        manageKeysUrl: `${APP_URL}/get-key`,
        docsUrl: `${APP_URL}/docs/authentication`,
      },
      userId: row.user_id as string,
    });

    if (!result.success) {
      errors.push(`key ${row.id}: ${result.error ?? "send failed"}`);
      continue;
    }

    const { error: upErr } = await admin
      .from("agent_api_keys")
      .update({ [col]: now.toISOString() })
      .eq("id", row.id);

    if (upErr) {
      errors.push(`key ${row.id}: sent email but failed to set ${col}: ${upErr.message}`);
    } else {
      sent++;
    }
  }

  return { sent, skipped, errors };
}
