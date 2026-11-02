/**
 * Confirmation tokens for the security master feed's double opt-in.
 *
 * The token is 32 random bytes, base64url (43 characters). It goes in the
 * confirmation email's link once; only its sha256 is stored
 * (feed_waitlist.confirm_token_hash), so a database read does not yield a
 * usable link. It expires after CONFIRM_TOKEN_TTL_MS.
 */

import { createHash, randomBytes } from "node:crypto";

/** The link stops working after seven days. */
export const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A new confirmation email for the same address waits at least this long. */
export const CONFIRM_MIN_INTERVAL_SEC = 15 * 60;
/** At most this many confirmation emails are ever queued for one address. */
export const CONFIRM_MAX_SENDS = 3;

export const CONFIRM_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newConfirmToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashConfirmToken(token) };
}
