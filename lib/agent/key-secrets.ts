/**
 * Secrets behind API key checksums and stored key hashes.
 *
 * `API_KEY_SECRET` feeds the checksum suffix; `API_KEY_SALT` (falling back to
 * `API_KEY_SECRET`) salts the stored SHA-256 hash. When they are unset the
 * built-in defaults below are used.
 *
 * Production runs on those defaults today (neither variable is set), and
 * every stored hash in `agent_api_keys` / `user_generated_api_keys` was made
 * with the default salt. So this module must keep returning exactly the same
 * values as before: throwing here would fail every key request, and setting
 * the variables would invalidate every existing key. Moving off the defaults
 * needs a rotation that accepts old and new for a period and re-hashes on use
 * (docs/BACKLOG.md RMAPI-32).
 *
 * The only behaviour added is visibility: one `console.error` per process in
 * production when a default is in use. No value is logged.
 */

const DEFAULT_SECRET = "default-secret";
const DEFAULT_SALT = "default-salt";

let reported = false;
function reportDefaultInUse(): void {
  if (reported || process.env.NODE_ENV !== "production") return;
  reported = true;
  console.error(
    "[key-secrets] API_KEY_SECRET / API_KEY_SALT are not set: API key checksums and hashes use the built-in defaults. " +
      "Do not set them without a dual-accept rotation; existing keys would stop validating.",
  );
}

/** Test seam: allow the once-per-process report to fire again. */
export function __resetKeySecretReport(): void {
  reported = false;
}

/** Secret mixed into the key checksum suffix. */
export function apiKeyChecksumSecret(): string {
  const secret = process.env.API_KEY_SECRET;
  if (secret) return secret;
  reportDefaultInUse();
  return DEFAULT_SECRET;
}

/** Salt for the stored key hash: `API_KEY_SALT`, else `API_KEY_SECRET`, else the default. */
export function apiKeyHashSalt(): string {
  const salt = process.env.API_KEY_SALT || process.env.API_KEY_SECRET;
  if (salt) return salt;
  reportDefaultInUse();
  return DEFAULT_SALT;
}
