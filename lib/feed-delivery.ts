/**
 * Asking a feed delivery address (a team inbox or agent inbox) to confirm for itself.
 *
 * One path for every way a delivery address gets linked to a contact:
 *   - the contact named it at signup and then confirmed (POST /api/feed-waitlist/confirm);
 *   - the contact asked from an edition footer and confirmed that request by email
 *     (POST /api/feed-waitlist/delivery/confirm);
 *   - the operator added it from BWMACRO /admin/feed-list (scripts/feed-admin.ts add-delivery).
 *
 * The same atomic, throttled claim as a signup (feed_waitlist_claim_confirmation), so the
 * address is never mailed twice in a row, past the cap, or after it has consented or
 * unsubscribed. Until it confirms it receives nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendFeedDeliveryConfirmation, type FeedConfirmRow } from "@/lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_WINDOW_SEC,
  CONFIRM_TOKEN_TTL_MS,
  newConfirmToken,
} from "@/lib/feed-token";

export type DeliveryConfirmOutcome = "confirmation_sent" | "not_sent";

export class FeedDeliveryError extends Error {
  readonly event: "delivery_claim_failed" | "delivery_send_failed";
  constructor(event: "delivery_claim_failed" | "delivery_send_failed") {
    super(`feed_${event}`);
    this.name = "FeedDeliveryError";
    this.event = event;
  }
}

/**
 * Sends the delivery confirmation when the claim allows it. "not_sent" means the address is already
 * confirmed, unsubscribed, or was mailed too recently; the caller reports it, nothing else changes.
 */
export async function askDeliveryAddressToConfirm(
  admin: SupabaseClient,
  feedEmail: string,
  requestedBy: { email: string; name: string | null },
): Promise<DeliveryConfirmOutcome> {
  const fresh = newConfirmToken();
  const { data, error } = await admin.rpc("feed_waitlist_claim_confirmation", {
    p_email: feedEmail,
    p_token_hash: fresh.hash,
    p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
    p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
    p_max_sends: CONFIRM_MAX_SENDS,
    p_window_seconds: CONFIRM_WINDOW_SEC,
  });
  if (error) throw new FeedDeliveryError("delivery_claim_failed");
  const target = Array.isArray(data) && data.length > 0 ? (data[0] as FeedConfirmRow) : null;
  if (!target) return "not_sent";
  try {
    await sendFeedDeliveryConfirmation(target, fresh.token, requestedBy);
  } catch {
    throw new FeedDeliveryError("delivery_send_failed");
  }
  return "confirmation_sent";
}
