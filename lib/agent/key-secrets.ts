/**
 * Secrets behind API key checksums and stored key hashes, with a rotation
 * window (RMAPI-32).
 *
 * `API_KEY_SECRET` feeds the checksum suffix; `API_KEY_SALT` (falling back to
 * `API_KEY_SECRET`) salts the stored SHA-256 hash. Until 2026-11 production
 * ran with neither set, so every stored hash in `agent_api_keys` /
 * `user_generated_api_keys` was made with the built-in defaults below.
 *
 * Rotation:
 *  - New keys are always issued with the configured values (the defaults only
 *    when nothing is configured).
 *  - Validation also accepts the defaults while the legacy window is open
 *    (`API_KEY_ACCEPT_LEGACY` unset or anything but "off"). A key that matches
 *    on the default salt is re-hashed to the configured salt when it is used
 *    (`api-keys.ts` `validateApiKey`).
 *  - `scripts/key-rotation-status.mjs` reports how many unrevoked keys have
 *    not been used since the rotation started, i.e. still carry a default-salt
 *    hash. Setting `API_KEY_ACCEPT_LEGACY=off` ends the window: those keys
 *    stop validating.
 *
 * One `console.error` per process in production while the defaults are the
 * configured values. No value is ever logged.
 */

import crypto from "crypto";

const DEFAULT_SECRET = "default-secret";
const DEFAULT_SALT = "default-salt";

let reported = false;
function reportDefaultInUse(): void {
  if (reported || process.env.NODE_ENV !== "production") return;
  reported = true;
  console.error(
    "[key-secrets] API_KEY_SECRET / API_KEY_SALT are not set: API key checksums and hashes use the built-in defaults (RMAPI-32).",
  );
}

/** Test seam: allow the once-per-process report to fire again. */
export function __resetKeySecretReport(): void {
  reported = false;
}

/** Empty strings count as unset (Vercel can hold `""`). */
function envValue(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

function legacyAccepted(): boolean {
  return (process.env.API_KEY_ACCEPT_LEGACY ?? "").trim().toLowerCase() !== "off";
}

/** Secret mixed into the checksum suffix of newly issued keys. */
export function apiKeyChecksumSecret(): string {
  const secret = envValue("API_KEY_SECRET");
  if (secret) return secret;
  reportDefaultInUse();
  return DEFAULT_SECRET;
}

/** Salt for the stored hash of newly issued keys: `API_KEY_SALT`, else `API_KEY_SECRET`, else the default. */
export function apiKeyHashSalt(): string {
  const salt = envValue("API_KEY_SALT") ?? envValue("API_KEY_SECRET");
  if (salt) return salt;
  reportDefaultInUse();
  return DEFAULT_SALT;
}

function withLegacy(current: string, legacy: string): string[] {
  return current !== legacy && legacyAccepted() ? [current, legacy] : [current];
}

/** Checksum secrets a presented key may have been issued under, current first. */
export function apiKeyChecksumSecrets(): string[] {
  return withLegacy(apiKeyChecksumSecret(), DEFAULT_SECRET);
}

/** Salts a stored hash may have been made with, current first. */
export function apiKeyHashSalts(): string[] {
  return withLegacy(apiKeyHashSalt(), DEFAULT_SALT);
}

/** Stored hash of `plainKey` under `salt`. Same formula for rm_agent_* and rm_user_* keys. */
export function hashKeyWithSalt(plainKey: string, salt: string): string {
  return crypto.createHash("sha256").update(plainKey + salt).digest("hex");
}

/**
 * Hashes to look up for a presented key, current salt first. The first entry
 * is the hash a key should carry after re-hashing.
 */
export function apiKeyHashCandidates(plainKey: string): string[] {
  return apiKeyHashSalts().map((salt) => hashKeyWithSalt(plainKey, salt));
}
