/**
 * Private feed credentials for approved subscribers.
 *
 * A credential is a random value shown to the subscriber once. Only its sha256
 * is stored (feed_access_tokens.token_hash), so a database read cannot recover
 * it. It is its own kind of secret: not the unsubscribe token, not the
 * confirmation token, not an API key. It opens the private Event Ledger feed and
 * nothing else, belongs to one approved contact, and stops working when that
 * contact unsubscribes, is rejected or revoked, or asks for a new one.
 *
 * The database decides. feed_access_check() answers true only for a live
 * credential whose contact is confirmed, not unsubscribed and approved, which is
 * the same rule that selects edition recipients.
 *
 * A credential is created from a single-use emailed link (feed_access_claim_link
 * and feed_access_issue), so creating one proves control of the approved address.
 *
 * Nothing here logs a credential, a link token or a request URL.
 */
import { createHash, randomBytes } from "node:crypto";

export const FEED_KEY_PREFIX = "rmf_";
export const FEED_KEY_RE = /^rmf_[A-Za-z0-9_-]{43}$/;
/** The emailed link that creates a credential is valid for one hour. */
export const ACCESS_LINK_TTL_MS = 60 * 60 * 1000;
export const ACCESS_LINK_MIN_INTERVAL_SEC = 5 * 60;
export const ACCESS_LINK_MAX_SENDS = 5;
export const ACCESS_LINK_WINDOW_SEC = 24 * 60 * 60;

export function hashFeedKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newFeedKey(): { key: string; hash: string } {
  const key = FEED_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, hash: hashFeedKey(key) };
}

/**
 * The credential a request presents: `Authorization: Bearer <key>`, else `?key=`.
 * Feed readers can only send a URL, so the query form is supported. null when
 * absent or not shaped like a credential (no database call is made for those).
 */
export function readFeedKey(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1];
  const candidate = bearer ?? new URL(req.url).searchParams.get("key") ?? "";
  return FEED_KEY_RE.test(candidate) ? candidate : null;
}

export type FeedKeyCheck = "ok" | "denied" | "unavailable";

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Asks the database whether the credential is live and its contact still eligible. */
export async function checkFeedKey(admin: RpcClient, key: string | null): Promise<FeedKeyCheck> {
  if (!key) return "denied";
  try {
    const { data, error } = await admin.rpc("feed_access_check", { p_token_hash: hashFeedKey(key) });
    if (error) return "unavailable";
    return data === true ? "ok" : "denied";
  } catch {
    return "unavailable";
  }
}

/** Headers for every private-feed response: never cached by a shared cache, never indexed, no referrer. */
export const PRIVATE_FEED_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
} as const;
