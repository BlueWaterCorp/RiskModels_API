import { createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WebhookEventId } from "@/lib/api/schemas";

/** Row shape returned by `select` for outbound delivery (no `user_id` in select list). */
type WebhookSubscriptionRow = {
  id: string;
  url: string;
  secret: string;
  events: string[] | null;
  active: boolean;
};

/**
 * Sign raw JSON body bytes for delivery verification (HMAC-SHA256).
 * Header format: `sha256=<hex>` on `X-RiskModels-Signature`.
 */
export function signWebhookBody(secret: string, bodyUtf8: string): string {
  const h = createHmac("sha256", secret).update(bodyUtf8, "utf8").digest("hex");
  return `sha256=${h}`;
}

/**
 * POST signed JSON to each active subscription for this user that listens for `event`.
 * Fire-and-forget friendly: awaits network calls but callers typically void-wrap it.
 */
export async function dispatchWebhookEvent(
  userId: string,
  event: WebhookEventId,
  data: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("webhook_subscriptions")
    .select("id, url, secret, events, active")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) {
    console.error("[webhooks] list subscriptions:", error.message);
    return;
  }

  const subs = (rows ?? []).filter(
    (r: WebhookSubscriptionRow) => r.events?.includes(event),
  );
  if (subs.length === 0) return;

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map((sub: WebhookSubscriptionRow) =>
      deliverOneWebhook(sub, event, body),
    ),
  );
}

async function deliverOneWebhook(
  sub: WebhookSubscriptionRow,
  event: WebhookEventId,
  body: string,
): Promise<void> {
  const signature = signWebhookBody(sub.secret, body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-RiskModels-Signature": signature,
        "X-RiskModels-Event": event,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[webhooks] delivery ${sub.id} HTTP ${res.status} ${res.statusText}`,
      );
    }
  } catch (e) {
    console.error(`[webhooks] delivery failed ${sub.id}`, e);
  } finally {
    clearTimeout(timeout);
  }
}
