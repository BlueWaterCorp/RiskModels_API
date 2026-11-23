/**
 * API Key Management
 *
 * Functions for generating, hashing, and validating API keys
 * for agent authentication.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";
import {
  apiKeyChecksumSecret,
  apiKeyChecksumSecrets,
  apiKeyHashCandidates,
  apiKeyHashSalt,
  hashKeyWithSalt,
} from "./key-secrets";

// Lazy initialization to avoid build-time errors
let supabase: ReturnType<typeof createAdminClient> | null = null;
function getSupabase() {
  if (!supabase) {
    supabase = createAdminClient();
  }
  return supabase;
}

/**
 * Record account-level "first API use" (activation) the first time any key is used.
 * Stored as `first_api_use_at` inside agent_accounts.signup_attribution (jsonb) — no
 * dedicated column (schema is governed in the private BWMACRO/supabase repo). Idempotent:
 * only sets the timestamp when absent, so re-runs are no-ops and the time stays stable
 * (Google Ads dedupes offline conversions by gclid + name + time). Powers the Phase-2
 * scheduled offline-conversion upload (see app/api/internal/google-ads/offline-conversions).
 * Best-effort and non-blocking; failures must never break API auth.
 */
async function recordActivationIfFirstUse(userId: string): Promise<void> {
  const sb = getSupabase();
  const { data: row, error: selErr } = await sb
    .from("agent_accounts")
    .select("id, signup_attribution")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selErr || !row?.id) return;

  const current = (row.signup_attribution ?? {}) as Record<string, unknown>;
  if (current.first_api_use_at) return; // already activated — keep first time

  await sb
    .from("agent_accounts")
    .update({
      signup_attribution: { ...current, first_api_use_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

// API key format: rm_agent_{env}_{random}_{checksum}
// Example: rm_agent_live_abc123xyz...

export interface ApiKeyResult {
  plainKey: string;
  hashedKey: string;
  prefix: string;
}

export interface ValidatedKey {
  valid: boolean;
  userId?: string;
  /** agent_api_keys / user_generated_api_keys row id (for per-key telemetry). */
  keyId?: string;
  keyPrefix?: string;
  scopes?: string[];
  rateLimit?: number;
  /** Tag describing the caller profile (e.g. 'mcp', 'cli'). Populated from agent_api_keys.key_scope. */
  keyScope?: string | null;
  /** Per-key daily spend cap in USD; falls back to account-level if unset. */
  dailySpendCapUsd?: number | null;
  /**
   * Org that pays for this key (agent_api_keys.org_id). Present only for org
   * keys; absent means the key bills its own user exactly as before.
   */
  orgId?: string;
  error?: string;
  /**
   * True when validation failed due to a server-side issue (not a bad key).
   * Example: Postgres 42703 (undefined_column) from a missed migration leaves
   * the middleware selecting columns the DB doesn't have. Callers should
   * surface 5xx rather than 401 so the real cause isn't masked as an auth bug.
   */
  serverError?: boolean;
}

/**
 * Generate a new API key
 *
 * Format: rm_agent_{env}_{random}_{checksum}
 * - env: 'live' for production, 'test' for sandbox
 * - random: base64url (32 chars)
 * - checksum: 8 char hash for validation
 */
export function generateApiKey(
  environment: "live" | "test" = "live",
): ApiKeyResult {
  const env = environment === "live" ? "live" : "test";

  // Generate random component (32 chars, alphanumeric only).
  // Draw more base64url bytes than we need and filter out `-` and `_` so the
  // issued key contains no characters that break word-boundary copy-paste
  // selection in terminals/editors. 48 random bytes → ~64 base64url chars,
  // with only ~6% expected loss from filtering.
  const random = crypto
    .randomBytes(48)
    .toString("base64url")
    .replace(/[-_]/g, "")
    .slice(0, 32);

  // Create the full key prefix
  const prefix = `rm_agent_${env}`;

  // Combine for full key (without checksum yet)
  const keyWithoutChecksum = `${prefix}_${random}`;

  // Generate checksum (base64url, strip _ and -, pad to 8).
  // Both `_` and `-` break word-boundary copy-paste selection in terminals
  // and editors, so the issued key should contain only [A-Za-z0-9x].
  let checksum = crypto
    .createHash("sha256")
    .update(keyWithoutChecksum + apiKeyChecksumSecret())
    .digest("base64url")
    .substring(0, 8)
    .replace(/[_-]/g, "");
  if (checksum.length < 8) {
    checksum += "x".repeat(8 - checksum.length);
  }

  // Full key
  const plainKey = `${keyWithoutChecksum}_${checksum}`;

  // Hash for storage (use bcrypt-like approach with salt)
  const hashedKey = hashApiKey(plainKey);

  return {
    plainKey,
    hashedKey,
    prefix: plainKey.substring(0, 16), // First 16 chars for display
  };
}

/**
 * Hash an API key for storage
 *
 * Uses SHA-256 with a secret salt. This is a one-way hash.
 * For production, consider using bcrypt or Argon2.
 */
export function hashApiKey(plainKey: string): string {
  return hashKeyWithSalt(plainKey, apiKeyHashSalt());
}

/**
 * Re-hash a key found under a legacy salt to the current salt (RMAPI-32).
 * Awaited so the write commits before a serverless function freezes; a
 * failure is logged and never fails authentication.
 */
async function rehashIfLegacy(
  table: "agent_api_keys" | "user_generated_api_keys",
  id: string,
  storedHash: string,
  currentHash: string,
): Promise<void> {
  if (storedHash === currentHash) return;
  try {
    const { error } = await getSupabase()
      .from(table)
      .update({ key_hash: currentHash })
      .eq("id", id)
      .eq("key_hash", storedHash);
    if (error) console.error(`[api-keys] re-hash ${table} ${id} failed: ${error.message}`);
  } catch (e) {
    console.error(`[api-keys] re-hash ${table} ${id} failed`, e);
  }
}

/**
 * Validate an API key format
 */
export function isValidApiKeyFormat(key: string): boolean {
  // Check prefix
  if (!key.startsWith("rm_agent_")) {
    return false;
  }

  // Check environment (third segment after rm_agent_)
  const afterPrefix = key.slice("rm_agent_".length);
  const envEnd = afterPrefix.indexOf("_");
  if (envEnd === -1) return false;
  const env = afterPrefix.slice(0, envEnd);
  if (env !== "live" && env !== "test") {
    return false;
  }

  // The checksum is always the last 8-char segment.
  // Use lastIndexOf to handle base64url random bytes that may contain underscores.
  const lastUnderscore = key.lastIndexOf("_");
  if (lastUnderscore === -1) return false;
  const keyWithoutChecksum = key.slice(0, lastUnderscore);
  const checksum = key.slice(lastUnderscore + 1);

  return apiKeyChecksumSecrets().some((secret) =>
    checksumMatches(keyWithoutChecksum + secret, checksum),
  );
}

/** True when `checksum` is one of the three checksum encodings ever issued for `hashInput`. */
function checksumMatches(hashInput: string, checksum: string): boolean {
  const rawBase64url = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("base64url")
    .substring(0, 8);

  // Current format: base64url with both `_` and `-` stripped, padded to 8.
  let expectedBase64url = rawBase64url.replace(/[_-]/g, "");
  if (expectedBase64url.length < 8) {
    expectedBase64url += "x".repeat(8 - expectedBase64url.length);
  }

  // Legacy format (pre-dash-strip): only `_` was stripped. Keep accepting
  // these so keys issued before the alphabet fix continue to validate.
  let legacyUnderscoreOnly = rawBase64url.replace(/_/g, "");
  if (legacyUnderscoreOnly.length < 8) {
    legacyUnderscoreOnly += "x".repeat(8 - legacyUnderscoreOnly.length);
  }

  // Legacy: hex keys from brief deploy — accept too.
  const expectedHex = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("hex")
    .substring(0, 8);

  return (
    checksum === expectedBase64url ||
    checksum === legacyUnderscoreOnly ||
    checksum === expectedHex
  );
}

/**
 * Validate an API key against the database.
 * Handles both agent keys (rm_agent_*  → agent_api_keys)
 * and user-generated keys (rm_user_* → user_generated_api_keys).
 */
export async function validateApiKey(plainKey: string): Promise<ValidatedKey> {
  const isUserKey = plainKey.startsWith("rm_user_");

  if (isUserKey) {
    // User-generated keys use a separate hash function and table
    const candidates = apiKeyHashCandidates(plainKey);

    const { data: keyRecord, error } = await getSupabase()
      .from("user_generated_api_keys")
      .select("id, user_id, key_prefix, key_hash, scopes, rate_limit_per_minute, revoked_at, expires_at, last_used_at")
      .in("key_hash", candidates)
      .single();

    if (error && (error as { code?: string }).code === "42703") {
      return {
        valid: false,
        serverError: true,
        error: `SERVER_SCHEMA_ERROR: user_generated_api_keys schema mismatch (${error.message}). Likely a missed migration.`,
      };
    }
    if (error || !keyRecord) {
      return { valid: false, error: "API key not found" };
    }
    if (keyRecord.revoked_at) {
      return { valid: false, error: "API key has been revoked" };
    }
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    await rehashIfLegacy("user_generated_api_keys", keyRecord.id, keyRecord.key_hash, candidates[0]);

    // Update last used timestamp (non-blocking)
    void Promise.resolve(
      getSupabase()
        .from("user_generated_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyRecord.id),
    ).catch(console.error);

    // Activation tracking: first time this key is used → record account-level first
    // API use. Awaited (not fire-and-forget) so the write commits before the
    // serverless function freezes — the void version silently lost ~7/8 real
    // activations. Wrapped so a failure never breaks API auth.
    if (!keyRecord.last_used_at) {
      try {
        await recordActivationIfFirstUse(keyRecord.user_id);
      } catch (e) {
        console.error("recordActivationIfFirstUse failed", e);
      }
    }

    return {
      valid: true,
      userId: keyRecord.user_id,
      keyId: keyRecord.id,
      keyPrefix: keyRecord.key_prefix ?? undefined,
      scopes: keyRecord.scopes,
      rateLimit: keyRecord.rate_limit_per_minute ?? 30,
    };
  }

  // Agent keys (rm_agent_*)
  if (!isValidApiKeyFormat(plainKey)) {
    return { valid: false, error: "Invalid API key format" };
  }

  const candidates = apiKeyHashCandidates(plainKey);

  const AGENT_KEY_COLUMNS =
    "id, user_id, key_prefix, key_hash, scopes, rate_limit_per_minute, revoked_at, expires_at, key_scope, daily_spend_cap_usd, last_used_at";
  const selectKey = (columns: string) =>
    getSupabase().from("agent_api_keys").select(columns).in("key_hash", candidates).single();

  // org_id is read alongside the existing columns; if the column is not there
  // yet (schema behind the code), fall back to the original select so personal
  // keys keep working.
  let { data: keyRecord, error } = (await selectKey(`${AGENT_KEY_COLUMNS}, org_id`)) as {
    data: Record<string, any> | null;
    error: { code?: string; message: string } | null;
  };
  if (error && (error as { code?: string }).code === "42703") {
    ({ data: keyRecord, error } = (await selectKey(AGENT_KEY_COLUMNS)) as {
      data: Record<string, any> | null;
      error: { code?: string; message: string } | null;
    });
  }

  if (error && (error as { code?: string }).code === "42703") {
    return {
      valid: false,
      serverError: true,
      error: `SERVER_SCHEMA_ERROR: agent_api_keys schema mismatch (${error.message}). Likely a missed migration.`,
    };
  }
  if (error || !keyRecord) {
    return { valid: false, error: "API key not found" };
  }

  if (keyRecord.revoked_at) {
    return { valid: false, error: "API key has been revoked" };
  }

  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return { valid: false, error: "API key has expired" };
  }

  // Org keys: the org must be active and unexpired and the holder still a
  // member. Personal keys (org_id NULL) skip this entirely.
  const orgId: string | null = keyRecord.org_id ?? null;
  if (orgId) {
    const { checkOrgKeyAccess } = await import("./orgs");
    const access = await checkOrgKeyAccess(orgId, keyRecord.user_id);
    if (!access.ok) {
      return { valid: false, error: access.error, serverError: access.serverError };
    }
  }

  await rehashIfLegacy("agent_api_keys", keyRecord.id, keyRecord.key_hash, candidates[0]);

  // Update last used timestamp (non-blocking)
  void Promise.resolve(
    getSupabase()
      .from("agent_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRecord.id),
  ).catch(console.error);

  // Activation tracking: first time this key is used → record account-level first
  // API use. Awaited (not fire-and-forget) so the write commits before the
  // serverless function freezes — the void version silently lost ~7/8 real
  // activations. Wrapped so a failure never breaks API auth.
  if (!keyRecord.last_used_at) {
    try {
      await recordActivationIfFirstUse(keyRecord.user_id);
    } catch (e) {
      console.error("recordActivationIfFirstUse failed", e);
    }
  }

  const perKeyDailyCap =
    keyRecord.daily_spend_cap_usd != null
      ? parseFloat(String(keyRecord.daily_spend_cap_usd))
      : null;

  return {
    valid: true,
    userId: keyRecord.user_id,
    keyId: keyRecord.id,
    keyPrefix: keyRecord.key_prefix ?? undefined,
    scopes: keyRecord.scopes,
    rateLimit: keyRecord.rate_limit_per_minute,
    keyScope: keyRecord.key_scope ?? null,
    dailySpendCapUsd: perKeyDailyCap,
    ...(orgId ? { orgId } : {}),
  };
}

/**
 * Extract API key from request headers
 *
 * Supports:
 * - Authorization: Bearer {api_key}
 * - X-API-Key: {api_key}
 */
export function extractApiKey(request: Request): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  // Try X-API-Key header
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  userId: string,
  keyPrefix: string,
): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("agent_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("key_prefix", keyPrefix)
      .is("revoked_at", null);

    if (error) {
      console.error("[API Keys] Error revoking key:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[API Keys] Exception revoking key:", error);
    return false;
  }
}

/**
 * List API keys for a user
 */
export async function listApiKeys(userId: string): Promise<
  {
    id: string;
    prefix: string;
    name: string;
    scopes: string[];
    last_used_at?: string;
    created_at: string;
  }[]
> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("agent_api_keys")
      .select("id, key_prefix, name, scopes, last_used_at, created_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map((key: any) => ({
      id: key.id,
      prefix: key.key_prefix,
      name: key.name,
      scopes: key.scopes,
      last_used_at: key.last_used_at,
      created_at: key.created_at,
    }));
  } catch (error) {
    console.error("[API Keys] Error listing keys:", error);
    return [];
  }
}
