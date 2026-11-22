/**
 * Issue a user's first API key without a click, exactly once.
 *
 * /get-key calls this on every signed-in load. A reload, a second tab or a
 * retried request must not produce a second key, and the guard has to hold
 * across serverless instances, so it lives in the database rather than in a
 * client effect or process memory.
 *
 * The guard is the existing UNIQUE constraint on `agent_api_keys.key_hash`:
 *
 *   1. Count the user's keys (any status). Any key at all: nothing to do.
 *   2. Insert a placeholder row whose key_hash is `first-key-pending:<user id>`,
 *      already revoked. Only one request can hold it; a concurrent one gets a
 *      unique violation (Postgres makes the second insert wait for the first).
 *   3. Count again, excluding the placeholder. A request that finished between
 *      steps 1 and 2 is visible now; if so, back off.
 *   4. Insert the real key, then delete the placeholder.
 *
 * The placeholder can never authenticate: validation hashes the presented key
 * with the server salt, which cannot equal the placeholder string, and the row
 * is revoked. A placeholder left behind by a crash is removed after
 * {@link STALE_PLACEHOLDER_MS} so it cannot block issuance for good.
 */
import { generateApiKey } from "@/lib/agent/api-keys";

export const FIRST_KEY_NAME = "API Key 1";
export const STALE_PLACEHOLDER_MS = 2 * 60 * 1000;
const PLACEHOLDER_PREFIX = "first-key-pending:";
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function firstKeyPlaceholderHash(userId: string): string {
  return `${PLACEHOLDER_PREFIX}${userId}`;
}

/** True for the transient placeholder row, so listings can leave it out. */
export function isFirstKeyPlaceholder(row: { key_hash?: unknown; key_prefix?: unknown }): boolean {
  return (
    (typeof row.key_hash === "string" && row.key_hash.startsWith(PLACEHOLDER_PREFIX)) ||
    row.key_prefix === PLACEHOLDER_KEY_PREFIX
  );
}

/** Stored in key_prefix on the placeholder; not a prefix any real key has. */
export const PLACEHOLDER_KEY_PREFIX = "pending";

export interface IssuedFirstKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  plainKey: string;
}

export type FirstKeyResult =
  | { issued: true; key: IssuedFirstKey }
  | { issued: false; reason: "has_key" | "in_progress" | "error" };

type Admin = { from: (table: string) => any };

async function countRealKeys(admin: Admin, userId: string): Promise<number | null> {
  const { count, error } = await admin
    .from("agent_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("key_hash", firstKeyPlaceholderHash(userId));
  if (error || typeof count !== "number") return null;
  return count;
}

async function insertPlaceholder(admin: Admin, userId: string, now: number) {
  return admin.from("agent_api_keys").insert({
    user_id: userId,
    key_hash: firstKeyPlaceholderHash(userId),
    key_prefix: PLACEHOLDER_KEY_PREFIX,
    name: "(issuing first key)",
    scopes: [],
    rate_limit_per_minute: 1,
    revoked_at: new Date(now).toISOString(),
    expires_at: new Date(now).toISOString(),
  });
}

async function deletePlaceholder(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin
    .from("agent_api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("key_hash", firstKeyPlaceholderHash(userId));
  if (error) console.error("[first-key] placeholder delete failed:", error.message);
}

/** Remove a placeholder older than the stale window. Returns whether it did. */
async function clearStalePlaceholder(admin: Admin, userId: string, now: number): Promise<boolean> {
  const { data, error } = await admin
    .from("agent_api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("key_hash", firstKeyPlaceholderHash(userId))
    .lt("created_at", new Date(now - STALE_PLACEHOLDER_MS).toISOString())
    .select("id");
  return !error && Array.isArray(data) && data.length > 0;
}

export async function issueFirstKeyIfNone(
  admin: Admin,
  userId: string,
  opts?: {
    referralCode?: string | null;
    referredByAffiliateId?: string | null;
    now?: number;
  },
): Promise<FirstKeyResult> {
  const now = opts?.now ?? Date.now();

  const before = await countRealKeys(admin, userId);
  if (before === null) return { issued: false, reason: "error" };
  if (before > 0) return { issued: false, reason: "has_key" };

  let { error: lockErr } = await insertPlaceholder(admin, userId, now);
  if (lockErr && (lockErr as { code?: string }).code === "23505") {
    // Another request holds it, unless it is a leftover from a crash.
    if (!(await clearStalePlaceholder(admin, userId, now))) {
      return { issued: false, reason: "in_progress" };
    }
    ({ error: lockErr } = await insertPlaceholder(admin, userId, now));
    if (lockErr) return { issued: false, reason: "in_progress" };
  } else if (lockErr) {
    console.error("[first-key] placeholder insert failed:", lockErr.message);
    return { issued: false, reason: "error" };
  }

  try {
    const after = await countRealKeys(admin, userId);
    if (after === null) return { issued: false, reason: "error" };
    if (after > 0) return { issued: false, reason: "has_key" };

    const { plainKey, hashedKey, prefix } = generateApiKey("live");
    const { data, error } = await admin
      .from("agent_api_keys")
      .insert({
        user_id: userId,
        key_hash: hashedKey,
        key_prefix: prefix,
        name: FIRST_KEY_NAME,
        scopes: ["*"],
        rate_limit_per_minute: 60,
        expires_at: new Date(now + YEAR_MS).toISOString(),
        referral_code: opts?.referralCode ?? null,
        referred_by_affiliate_id: opts?.referredByAffiliateId ?? null,
      })
      .select("id, name, key_prefix, created_at, expires_at")
      .single();
    if (error || !data) {
      console.error("[first-key] key insert failed:", error?.message);
      return { issued: false, reason: "error" };
    }
    return { issued: true, key: { ...(data as Omit<IssuedFirstKey, "plainKey">), plainKey } };
  } finally {
    await deletePlaceholder(admin, userId);
  }
}
