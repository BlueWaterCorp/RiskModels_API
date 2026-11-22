/**
 * Supabase Auth captcha (Cloudflare Turnstile) support, off until configured.
 *
 * When captcha protection is switched on for the Supabase project, every
 * signUp / signInWithOtp / signInWithPassword / resetPasswordForEmail call
 * must carry `options.captchaToken` or Supabase rejects it. The widget and the
 * token are gated on `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: unset means no widget
 * renders, no token is sent, and the calls are byte-for-byte what they were.
 */

/** Hidden field Turnstile adds to the enclosing form (implicit rendering). */
export const TURNSTILE_FORM_FIELD = "cf-turnstile-response";
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function turnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key ? key : null;
}

export function captchaEnabled(): boolean {
  return turnstileSiteKey() !== null;
}

/** `{ captchaToken }` when there is a token, else `{}`: spread into `options`. */
export function captchaOption(token: string | null | undefined): { captchaToken?: string } {
  const t = typeof token === "string" ? token.trim() : "";
  return t ? { captchaToken: t } : {};
}
