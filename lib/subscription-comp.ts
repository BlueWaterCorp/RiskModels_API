/**
 * Complimentary full access (professional-tier product behavior, no Stripe charge).
 * Configure via SUBSCRIPTION_COMP_EMAILS (comma-separated, case-insensitive).
 */
const COMP_SUBSCRIPTION_EMAILS = new Set(
  (process.env.SUBSCRIPTION_COMP_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean),
);

export function isComplimentaryProfessionalEmail(
  email?: string | null,
): boolean {
  if (!email) return false;
  return COMP_SUBSCRIPTION_EMAILS.has(email.toLowerCase().trim());
}

/** Env allowlist or DB flag set from BWMACRO admin (API Keys & NET Comps). */
export function hasComplimentaryProfessionalAccess(
  email?: string | null,
  profileComplimentaryFlag?: boolean | null,
  profileComplimentaryUntil?: string | null,
): boolean {
  if (isComplimentaryProfessionalEmail(email)) return true;
  if (!profileComplimentaryFlag) return false;
  if (!profileComplimentaryUntil) return true;
  const end = new Date(profileComplimentaryUntil);
  if (Number.isNaN(end.getTime())) return true;
  return end.getTime() > Date.now();
}
