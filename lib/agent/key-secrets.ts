/**
 * Secrets behind API key checksums and stored key hashes.
 *
 * `API_KEY_SECRET` feeds the checksum suffix; `API_KEY_SALT` (falling back to
 * `API_KEY_SECRET`) salts the stored SHA-256 hash. Both used to fall back to
 * hard-coded strings when unset, so a production deploy missing the variables
 * issued and accepted keys anyone could forge a checksum for, and hashed them
 * with a public salt, without any error.
 *
 * Production now refuses: the first key operation throws
 * `KeySecretConfigError`. Local dev and tests keep the old defaults so nothing
 * needs configuring, with one warning per process outside tests.
 */

const DEV_DEFAULT_SECRET = "default-secret";
const DEV_DEFAULT_SALT = "default-salt";

export class KeySecretConfigError extends Error {
  constructor(variable: string) {
    super(
      `${variable} is not set. API keys cannot be issued or validated in production without it; ` +
        "set it in the deployment environment (see DEPLOYMENT.md).",
    );
    this.name = "KeySecretConfigError";
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

let warned = false;
function warnDevDefault(variable: string): void {
  if (warned || process.env.NODE_ENV === "test") return;
  warned = true;
  console.warn(
    `[key-secrets] ${variable} is not set; using the development default. Production refuses to run this way.`,
  );
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value : null;
}

/** Secret mixed into the key checksum suffix. */
export function apiKeyChecksumSecret(): string {
  const secret = readEnv("API_KEY_SECRET");
  if (secret) return secret;
  if (isProduction()) throw new KeySecretConfigError("API_KEY_SECRET");
  warnDevDefault("API_KEY_SECRET");
  return DEV_DEFAULT_SECRET;
}

/** Salt for the stored key hash: `API_KEY_SALT`, else `API_KEY_SECRET`. */
export function apiKeyHashSalt(): string {
  const salt = readEnv("API_KEY_SALT") ?? readEnv("API_KEY_SECRET");
  if (salt) return salt;
  if (isProduction()) throw new KeySecretConfigError("API_KEY_SALT / API_KEY_SECRET");
  warnDevDefault("API_KEY_SALT");
  return DEV_DEFAULT_SALT;
}
