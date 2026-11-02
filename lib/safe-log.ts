/**
 * Log-safe error codes.
 *
 * Upstream error text can carry personal data: a database error may quote the
 * row that failed (an email address), and a mail-provider or network error may
 * quote the recipient or a URL with a token in it. Routes that handle signups
 * and unsubscribes log only a fixed event name plus the code returned here,
 * never a message or a raw exception.
 *
 * Every value returned is drawn from a fixed allowlist, so no caller-controlled
 * or upstream-controlled string can reach a log:
 *   - Postgres SQLSTATE codes (five characters, digits and capitals, e.g. 23505)
 *     and PostgREST codes (PGRST plus three digits) from an object's `code`;
 *   - Resend error names from the fixed list below, taken from the `<code>:`
 *     prefix that lib/resend-audit puts on provider errors;
 *   - standard error class names from the fixed list below.
 * Anything else is "unknown".
 */

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const POSTGREST_RE = /^PGRST\d{3}$/;

/** Error names Resend returns (https://resend.com/docs/api-reference/errors), plus our wrapper's fallback. */
const RESEND_CODES: ReadonlySet<string> = new Set([
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "rate_limit_exceeded",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_from_address",
  "validation_error",
  "not_found",
  "method_not_allowed",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "security_error",
  "application_error",
  "internal_server_error",
  "resend_error",
]);

const ERROR_NAMES: ReadonlySet<string> = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "AbortError",
  "TimeoutError",
]);

export function safeErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && (SQLSTATE_RE.test(code) || POSTGREST_RE.test(code))) return code;
  }
  if (err instanceof Error) {
    const prefix = err.message.split(":", 1)[0]?.trim() ?? "";
    if (RESEND_CODES.has(prefix)) return prefix;
    if (ERROR_NAMES.has(err.name)) return err.name;
  }
  return "unknown";
}
