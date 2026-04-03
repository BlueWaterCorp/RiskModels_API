import type { CreateEmailOptions, CreateEmailResponseSuccess, Resend } from "resend";

/**
 * Audit BCC for transactional `resend.emails.send` / `create` (not broadcasts/batch).
 * RESEND_BCC_EMAIL=0 or empty string disables. Default: resend@riskmodels.app (Workspace alias → service@ recommended).
 */
export function getResendAuditBcc(): string | undefined {
  const bccRaw = process.env.RESEND_BCC_EMAIL?.trim();
  if (bccRaw === "0" || bccRaw === "") return undefined;
  return bccRaw || "resend@riskmodels.app";
}

function normEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** Parse email from `Name <addr@domain>` or bare `addr@domain`. */
export function parseFromHeaderEmail(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  const raw = (m ? m[1]! : from).trim();
  if (!raw.includes("@")) return null;
  return raw;
}

/** True if `to` already includes `email` (Resend rejects duplicate to/bcc). */
function toIncludesEmail(
  to: CreateEmailOptions["to"],
  email: string,
): boolean {
  const e = normEmail(email);
  if (!e) return false;
  if (typeof to === "string") return normEmail(to) === e;
  if (Array.isArray(to)) return to.some((t) => normEmail(String(t)) === e);
  return false;
}

function mergeBcc(
  existing: string | string[] | undefined,
  audit: string,
): string | string[] {
  if (!existing) return audit;
  const list = Array.isArray(existing) ? [...existing] : [existing];
  if (!list.includes(audit)) list.push(audit);
  return list.length === 1 ? list[0]! : list;
}

/** Use with every `resend.emails.send` / `emails.create` payload so audit BCC is applied consistently. */
export function withResendAuditBcc(payload: CreateEmailOptions): CreateEmailOptions {
  const audit = getResendAuditBcc();
  if (!audit) return payload;
  if (toIncludesEmail(payload.to, audit)) return payload;
  const fromStr = typeof payload.from === "string" ? payload.from : "";
  const fromAddr = parseFromHeaderEmail(fromStr);
  if (fromAddr && normEmail(fromAddr) === normEmail(audit)) return payload;
  return { ...payload, bcc: mergeBcc(payload.bcc, audit) };
}

/**
 * Sends via Resend and throws on API failure.
 * The Resend client resolves with `{ error }` instead of rejecting — this wrapper throws.
 */
export async function sendResendEmail(
  resend: Resend,
  payload: CreateEmailOptions,
): Promise<CreateEmailResponseSuccess> {
  const result = await resend.emails.send(withResendAuditBcc(payload));
  if (result.error) {
    const code = result.error.name ?? "resend_error";
    const msg = result.error.message || code;
    throw new Error(`${code}: ${msg}`);
  }
  return result.data;
}
