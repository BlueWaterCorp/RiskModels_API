/**
 * Entitlement for the weekly pre-market hedge bulk feed.
 *
 * This is a bespoke feed, not a general capability: one call returns the whole
 * cross-section including the subsector ETF legs, which are proprietary
 * curation. Capability tier is the wrong control — "premium" would hand it to
 * anyone who upgrades.
 *
 * The right control already exists. Institutional clients carry
 * billing_mode=licensed with a license tier (lib/agent/licensed-billing.ts),
 * which is the actual commercial relationship rather than a parallel list that
 * has to be maintained by hand and can silently drift.
 *
 * FAILS CLOSED. Anything not matched below is refused.
 */

/**
 * License tiers entitled to the feed.
 *
 * Deliberately a constant rather than an env var: widening who receives the
 * subsector curation is an IP exposure decision and should go through review,
 * not a secrets change. Adding a tier here is a one-line PR.
 */
export const ENTITLED_LICENSE_TIERS: readonly string[] = ["firm"];

/** Comma- or space-separated account ids, for exceptions to the tier rule. */
export function parseAllowlist(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export interface WeeklyHedgeAccessInput {
  userId: string | undefined;
  /** From BillingContext — the account's billing mode. */
  billingMode: string | null | undefined;
  /** From BillingContext — e.g. "firm". */
  licenseTier: string | null | undefined;
  /**
   * The `x-admin-secret` header, NOT Authorization.
   *
   * Authorization is already consumed by API-key auth: extractApiKey reads
   * `Bearer ...` from it first, so an admin secret sent there is validated AS
   * an api key, fails, and 401s before this gate runs — the override would be
   * unreachable. A separate header keeps it usable alongside a normal key.
   */
  adminSecret: string | null;
  env?: { WEEKLY_HEDGE_ALLOWED_ACCOUNTS?: string; CRON_SECRET?: string };
}

export function isWeeklyHedgeAuthorized(input: WeeklyHedgeAccessInput): boolean {
  const env = input.env ?? process.env;

  // 1. Licensed institutional client on an entitled tier. This is the path
  //    real clients take, and it needs no configuration.
  if (
    input.billingMode === "licensed" &&
    typeof input.licenseTier === "string" &&
    ENTITLED_LICENSE_TIERS.includes(input.licenseTier.trim().toLowerCase())
  ) {
    return true;
  }

  // 2. Explicit exception by account id, for anyone entitled outside the tier
  //    rule. Empty or unset grants nothing.
  const allowed = parseAllowlist(env.WEEKLY_HEDGE_ALLOWED_ACCOUNTS);
  if (input.userId && allowed.has(input.userId)) return true;

  // 3. Admin override for internal verification. A SECOND factor: this runs
  //    inside withBilling, after authentication, so a valid API key is still
  //    required — the secret only bypasses entitlement.
  const secret = env.CRON_SECRET?.trim();
  if (secret && input.adminSecret?.trim() === secret) return true;

  return false;
}
