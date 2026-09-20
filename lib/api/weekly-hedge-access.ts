/**
 * Entitlement for the weekly pre-market hedge bulk feed.
 *
 * This is a bespoke feed for named accounts, not a general API capability: one
 * call returns the whole cross-section including the subsector ETF legs. Tier
 * is the wrong control — "premium" would hand it to anyone who upgrades — so
 * access is an explicit allowlist of account ids, plus the existing admin
 * bearer for internal checks.
 *
 * FAILS CLOSED. An unset or empty allowlist admits nobody but admin. A config
 * gap must not silently mean "open to everyone"; that is the failure mode this
 * gate exists to prevent.
 */

/** Comma- or space-separated account ids entitled to the feed. */
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
  /**
   * The `x-admin-secret` header, NOT Authorization.
   *
   * Authorization is already consumed by API-key auth: extractApiKey reads
   * `Bearer ...` first, so an admin secret sent there is validated AS an api
   * key, fails, and 401s before this gate runs — the override would be
   * unreachable. A separate header keeps it usable alongside a normal key.
   */
  adminSecret: string | null;
  /** Defaults to process.env; injectable for tests. */
  env?: { WEEKLY_HEDGE_ALLOWED_ACCOUNTS?: string; CRON_SECRET?: string };
}

export function isWeeklyHedgeAuthorized(input: WeeklyHedgeAccessInput): boolean {
  const env = input.env ?? process.env;

  // Admin override. Requires a valid API key as well — this runs inside
  // withBilling, after authentication — so it is a second factor, not a
  // replacement for one.
  const secret = env.CRON_SECRET?.trim();
  if (secret && input.adminSecret?.trim() === secret) return true;

  const allowed = parseAllowlist(env.WEEKLY_HEDGE_ALLOWED_ACCOUNTS);
  if (allowed.size === 0) return false;
  if (!input.userId) return false;
  return allowed.has(input.userId);
}
