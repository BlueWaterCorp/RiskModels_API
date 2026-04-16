/**
 * API Key Management
 *
 * Functions for generating, hashing, and validating API keys
 * for agent authentication.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

// Lazy initialization to avoid build-time errors
let supabase: ReturnType<typeof createAdminClient> | null = null;
function getSupabase() {
  if (!supabase) {
    supabase = createAdminClient();
  }
  return supabase;
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
  scopes?: string[];
  rateLimit?: number;
  /** Tag describing the caller profile (e.g. 'mcp', 'cli'). Populated from agent_api_keys.key_scope. */
  keyScope?: string | null;
  /** Per-key daily spend cap in USD; falls back to account-level if unset. */
  dailySpendCapUsd?: number | null;
  error?: string;
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

  // Generate random component (32 chars)
  const random = crypto
    .randomBytes(24)
    .toString("base64url")
    .replace(/^_+/, "")
    .replace(/_+$/, "");

  // Create the full key prefix
  const prefix = `rm_agent_${env}`;

  // Combine for full key (without checksum yet)
  const keyWithoutChecksum = `${prefix}_${random}`;

  // Generate checksum (base64url, strip _, pad to 8)
  let checksum = crypto
    .createHash("sha256")
    .update(
      keyWithoutChecksum + (process.env.API_KEY_SECRET || "default-secret"),
    )
    .digest("base64url")
    .substring(0, 8)
    .replace(/_/g, "");
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
  const salt =
    process.env.API_KEY_SALT || process.env.API_KEY_SECRET || "default-salt";

  return crypto
    .createHash("sha256")
    .update(plainKey + salt)
    .digest("hex");
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

  const hashInput =
    keyWithoutChecksum + (process.env.API_KEY_SECRET || "default-secret");

  // Current format: base64url (stripped _, padded to 8)
  let expectedBase64url = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("base64url")
    .substring(0, 8)
    .replace(/_/g, "");
  if (expectedBase64url.length < 8) {
    expectedBase64url += "x".repeat(8 - expectedBase64url.length);
  }

  // Legacy: hex keys from brief deploy — accept both
  const expectedHex = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("hex")
    .substring(0, 8);

  return checksum === expectedBase64url || checksum === expectedHex;
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
    const { hashApiKey: hashUserKey } = await import("@/lib/user-api-keys");
    const hashedKey = hashUserKey(plainKey);

    const { data: keyRecord, error } = await getSupabase()
      .from("user_generated_api_keys")
      .select("user_id, scopes, rate_limit_per_minute, revoked_at, expires_at")
      .eq("key_hash", hashedKey)
      .single();

    if (error || !keyRecord) {
      return { valid: false, error: "API key not found" };
    }
    if (keyRecord.revoked_at) {
      return { valid: false, error: "API key has been revoked" };
    }
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    // Update last used timestamp (non-blocking)
    void Promise.resolve(
      getSupabase()
        .from("user_generated_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("key_hash", hashedKey),
    ).catch(console.error);

    return {
      valid: true,
      userId: keyRecord.user_id,
      scopes: keyRecord.scopes,
      rateLimit: keyRecord.rate_limit_per_minute ?? 30,
    };
  }

  // Agent keys (rm_agent_*)
  if (!isValidApiKeyFormat(plainKey)) {
    return { valid: false, error: "Invalid API key format" };
  }

  const hashedKey = hashApiKey(plainKey);

  const { data: keyRecord, error } = await getSupabase()
    .from("agent_api_keys")
    .select(
      "user_id, scopes, rate_limit_per_minute, revoked_at, expires_at, key_scope, daily_spend_cap_usd",
    )
    .eq("key_hash", hashedKey)
    .single();

  if (error || !keyRecord) {
    return { valid: false, error: "API key not found" };
  }

  if (keyRecord.revoked_at) {
    return { valid: false, error: "API key has been revoked" };
  }

  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return { valid: false, error: "API key has expired" };
  }

  // Update last used timestamp (non-blocking)
  void Promise.resolve(
    getSupabase()
      .from("agent_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("key_hash", hashedKey),
  ).catch(console.error);

  const perKeyDailyCap =
    keyRecord.daily_spend_cap_usd != null
      ? parseFloat(String(keyRecord.daily_spend_cap_usd))
      : null;

  return {
    valid: true,
    userId: keyRecord.user_id,
    scopes: keyRecord.scopes,
    rateLimit: keyRecord.rate_limit_per_minute,
    keyScope: keyRecord.key_scope ?? null,
    dailySpendCapUsd: perKeyDailyCap,
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
