/**
 * Log-safe error codes.
 *
 * Upstream error text can carry personal data: a database error may quote the
 * row that failed (an email address), and a mail-provider or network error may
 * quote the recipient or a URL with a token in it. Routes that handle signups
 * and unsubscribes log only a fixed event name plus the code returned here,
 * never a message or a raw exception.
 *
 * The code is taken from, in order: an object's `code` (Postgres/PostgREST
 * codes such as 23505), the `<code>:` prefix that lib/resend-audit puts on
 * provider errors, or the Error's class name. Anything that does not match a
 * short identifier pattern becomes "unknown".
 */

const CODE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

export function safeErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && CODE_RE.test(code)) return code;
  }
  if (err instanceof Error) {
    const prefix = err.message.split(":", 1)[0]?.trim() ?? "";
    if (/^[a-z_]{1,40}$/.test(prefix) && prefix !== err.message.trim()) return prefix;
    if (/^[A-Za-z]{1,40}$/.test(err.name)) return err.name;
  }
  return "unknown";
}
