/**
 * Org accounts: one balance, daily cap and expiry shared by many members, each
 * holding their own key.
 *
 * A key whose `agent_api_keys.org_id` is set is charged to `api_orgs`; a key
 * with `org_id` NULL bills exactly as before (`agent_accounts` by user). Every
 * org function here is reached only when an org id is present, so personal
 * keys never touch this module.
 *
 * Schema (private schema repo): `api_orgs`, `api_org_members`,
 * `api_org_invites`, RPCs `deduct_org_balance`, `api_org_join`,
 * `api_org_remove_member`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { BalanceUnavailableError, deductBalance, getUserBalance } from "./billing";
import type { LicenseAccount } from "./licensed-billing";

let supabase: ReturnType<typeof createAdminClient> | null = null;
function getSupabase() {
  if (!supabase) supabase = createAdminClient();
  return supabase;
}

export const ORG_COLUMNS =
  "id, slug, name, status, billing_mode, license_tier, balance_usd, daily_spend_cap_usd, daily_spend_usd, daily_spend_reset_at, expires_at, allowed_email_domains, seat_limit, key_rate_limit_per_minute";

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | string;
  billing_mode: "prepaid" | "licensed" | string;
  license_tier: string | null;
  balance_usd: number | string;
  daily_spend_cap_usd: number | string | null;
  daily_spend_usd: number | string;
  daily_spend_reset_at: string | null;
  expires_at: string | null;
  allowed_email_domains: string[] | null;
  seat_limit: number | null;
  key_rate_limit_per_minute: number | null;
}

export type OrgRole = "admin" | "member";

/** Who pays for a request: the org when `orgId` is set, otherwise the user. */
export interface BillingPayer {
  userId: string;
  orgId?: string | null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

// ── Pure rules (unit-tested) ─────────────────────────────────────────────────

/** Why org access is closed, or null when it is open. */
export function orgInactiveReason(
  org: Pick<OrgRow, "status" | "expires_at">,
  now: Date = new Date(),
): "suspended" | "expired" | null {
  if (org.status !== "active") return "suspended";
  if (org.expires_at != null) {
    const t = new Date(org.expires_at).getTime();
    // An unreadable expiry is not evidence of a live entitlement.
    if (Number.isNaN(t) || t <= now.getTime()) return "expired";
  }
  return null;
}

/** Org spend so far in the current UTC day (the stored counter resets lazily). */
export function orgDailySpendToday(
  org: Pick<OrgRow, "daily_spend_usd" | "daily_spend_reset_at">,
  now: Date = new Date(),
): number {
  const spent = num(org.daily_spend_usd);
  if (!org.daily_spend_reset_at) return Number.isFinite(spent) ? spent : 0;
  const reset = new Date(org.daily_spend_reset_at);
  const sameDay =
    reset.getUTCFullYear() === now.getUTCFullYear() &&
    reset.getUTCMonth() === now.getUTCMonth() &&
    reset.getUTCDate() === now.getUTCDate();
  if (!sameDay) return 0;
  return Number.isFinite(spent) ? spent : 0;
}

export function orgDailyCap(org: Pick<OrgRow, "daily_spend_cap_usd">): number | null {
  if (org.daily_spend_cap_usd == null) return null;
  const cap = num(org.daily_spend_cap_usd);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

export function orgLicense(org: Pick<OrgRow, "billing_mode" | "license_tier">): LicenseAccount {
  if (org.billing_mode === "licensed") {
    return { billingMode: "licensed", licenseTier: org.license_tier ?? null };
  }
  return { billingMode: "prepaid", licenseTier: null };
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const t = email.trim().toLowerCase();
  const at = t.lastIndexOf("@");
  if (at <= 0 || at === t.length - 1) return null;
  return t.slice(at + 1);
}

export type JoinErrorCode =
  | "email_not_verified"
  | "domain_not_allowed"
  | "org_inactive"
  | "org_not_found"
  | "invalid_code"
  | "code_expired"
  | "code_full"
  | "seat_limit_reached"
  | "removed"
  | "invalid_email"
  | "invalid_via"
  | "not_member"
  | "server_error";

export const JOIN_ERROR_MESSAGES: Record<JoinErrorCode, string> = {
  email_not_verified: "Verify your email address before joining an organization.",
  domain_not_allowed: "Your email domain is not on this organization's allowlist. Ask the organization for a seat code.",
  org_inactive: "This organization's access has ended.",
  org_not_found: "Organization not found.",
  invalid_code: "Seat code not recognised.",
  code_expired: "This seat code has expired.",
  code_full: "This seat code has no seats left.",
  seat_limit_reached: "This organization has no seats left.",
  removed: "You were removed from this organization. Ask an organization admin to add you again.",
  invalid_email: "A valid email address is required.",
  invalid_via: "Invalid join method.",
  not_member: "Not a member of this organization.",
  server_error: "Could not update the organization. Try again.",
};

/**
 * Domain self-join pre-check. The `api_org_join` RPC repeats the domain and
 * status checks under a row lock; this check adds the one the database cannot
 * see: that the email was verified by sign-in.
 */
export function domainJoinEligibility(opts: {
  org: Pick<OrgRow, "status" | "expires_at" | "allowed_email_domains">;
  email: string | null | undefined;
  emailConfirmed: boolean;
  now?: Date;
}): { ok: true } | { ok: false; error_code: JoinErrorCode } {
  const domain = emailDomain(opts.email);
  if (!domain) return { ok: false, error_code: "invalid_email" };
  if (!opts.emailConfirmed) return { ok: false, error_code: "email_not_verified" };
  if (orgInactiveReason(opts.org, opts.now)) return { ok: false, error_code: "org_inactive" };
  const allowed = (opts.org.allowed_email_domains ?? []).map((d) => d.trim().toLowerCase());
  if (!allowed.includes(domain)) return { ok: false, error_code: "domain_not_allowed" };
  return { ok: true };
}

// ── Database access ──────────────────────────────────────────────────────────

export async function loadOrg(orgId: string): Promise<OrgRow | null> {
  const { data, error } = await getSupabase()
    .from("api_orgs")
    .select(ORG_COLUMNS)
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new BalanceUnavailableError("Could not read the organization", { cause: error });
  return (data as OrgRow | null) ?? null;
}

export async function getActiveMembership(
  orgId: string,
  userId: string,
): Promise<{ role: OrgRole } | null> {
  const { data, error } = await getSupabase()
    .from("api_org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) throw new BalanceUnavailableError("Could not read the membership", { cause: error });
  if (!data) return null;
  return { role: data.role === "admin" ? "admin" : "member" };
}

/**
 * Called by key validation for keys that carry an org id: the org must be
 * active and unexpired, and the key holder must still be a member.
 */
export async function checkOrgKeyAccess(
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; org: OrgRow } | { ok: false; error: string; serverError?: boolean }> {
  try {
    const org = await loadOrg(orgId);
    if (!org) return { ok: false, error: "Organization not found" };
    const reason = orgInactiveReason(org, now);
    if (reason === "expired") return { ok: false, error: "Organization access has expired" };
    if (reason === "suspended") return { ok: false, error: "Organization access is suspended" };
    const membership = await getActiveMembership(orgId, userId);
    if (!membership) return { ok: false, error: "Organization membership has ended" };
    return { ok: true, org };
  } catch (e) {
    return {
      ok: false,
      serverError: true,
      error: `SERVER_ERROR: organization lookup failed (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

export async function getOrgBalance(orgId: string): Promise<number> {
  const org = await loadOrg(orgId);
  if (!org) return 0;
  const bal = num(org.balance_usd);
  if (!Number.isFinite(bal)) throw new BalanceUnavailableError("Stored org balance is not a number");
  return bal;
}

export async function checkOrgDailySpendCap(
  orgId: string,
  requestedCost: number,
  now: Date = new Date(),
): Promise<{ exceeded: boolean; currentSpend: number; cap: number | null }> {
  try {
    const org = await loadOrg(orgId);
    if (!org) return { exceeded: false, currentSpend: 0, cap: null };
    const cap = orgDailyCap(org);
    const currentSpend = orgDailySpendToday(org, now);
    return { exceeded: cap != null && currentSpend + requestedCost > cap, currentSpend, cap };
  } catch (error) {
    // Same posture as the account-level check: the atomic RPC re-checks the cap.
    console.error("[Orgs] Error checking org daily spend cap:", error);
    return { exceeded: false, currentSpend: 0, cap: null };
  }
}

export class OrgChargeError extends Error {
  constructor(
    public readonly reason: "insufficient_balance" | "daily_cap" | "org_inactive" | "org_not_found" | "invalid_amount",
    public readonly detail: { balanceUsd?: number; dailySpendUsd?: number; dailyCapUsd?: number } = {},
  ) {
    // "Insufficient balance" matches the personal path so existing callers'
    // insufficient-balance handling applies unchanged.
    super(reason === "insufficient_balance" ? "Insufficient balance" : `Org charge rejected: ${reason}`);
    this.name = "OrgChargeError";
  }
}

/**
 * Atomic org charge via `deduct_org_balance` (row lock; checks status, expiry,
 * org daily cap and balance). Records a billing event under the member's
 * user id with `org_id` set.
 */
export async function deductOrgBalance(
  orgId: string,
  userId: string,
  amountUsd: number,
  requestId: string,
  capabilityId: string,
  metadata?: Record<string, unknown>,
): Promise<{ balanceAfterUsd: number }> {
  const client = getSupabase();
  const { data, error } = await client.rpc("deduct_org_balance", {
    p_org_id: orgId,
    p_amount: amountUsd,
  } as never);
  if (error) {
    console.error("[Orgs] RPC deduct_org_balance error:", error);
    throw new Error(`Failed to deduct org balance: ${error.message}`);
  }
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: OrgChargeError["reason"];
    balance_usd?: number | string;
    daily_spend_usd?: number | string;
    daily_spend_cap_usd?: number | string | null;
  };
  if (!res.ok) {
    throw new OrgChargeError(res.reason ?? "insufficient_balance", {
      balanceUsd: res.balance_usd != null ? num(res.balance_usd) : undefined,
      dailySpendUsd: res.daily_spend_usd != null ? num(res.daily_spend_usd) : undefined,
      dailyCapUsd: res.daily_spend_cap_usd != null ? num(res.daily_spend_cap_usd) : undefined,
    });
  }
  const balanceAfterUsd = num(res.balance_usd);

  const { error: billingError } = await client.from("billing_events").insert({
    user_id: userId,
    org_id: orgId,
    request_id: requestId,
    capability_id: capabilityId,
    cost_usd: amountUsd,
    balance_after_usd: Number.isFinite(balanceAfterUsd) ? balanceAfterUsd : null,
    type: "debit",
    description: `Request: ${capabilityId}`,
    metadata: metadata || {},
    created_at: new Date().toISOString(),
  });
  if (billingError) {
    console.warn(`[Orgs] Failed to insert org billing event: ${billingError.message}`);
  }
  return { balanceAfterUsd };
}

/** Charge whoever pays: the org for org keys, otherwise `deductBalance` unchanged. */
export async function chargePayer(
  payer: BillingPayer,
  amountUsd: number,
  requestId: string,
  capabilityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (payer.orgId) {
    await deductOrgBalance(payer.orgId, payer.userId, amountUsd, requestId, capabilityId, metadata);
    return;
  }
  await deductBalance(payer.userId, amountUsd, requestId, capabilityId, metadata);
}

export async function getPayerBalance(payer: BillingPayer): Promise<number> {
  return payer.orgId ? getOrgBalance(payer.orgId) : getUserBalance(payer.userId);
}

// ── Membership ───────────────────────────────────────────────────────────────

export type JoinVia = "domain" | "seat_code" | "org_admin";

export async function joinOrg(opts: {
  orgId: string;
  userId: string;
  email: string;
  via: JoinVia;
  role?: OrgRole;
  seatCode?: string | null;
  invitedBy?: string | null;
}): Promise<{ ok: true; memberId: string; alreadyMember: boolean } | { ok: false; error_code: JoinErrorCode }> {
  const { data, error } = await getSupabase().rpc("api_org_join", {
    p_org_id: opts.orgId,
    p_user_id: opts.userId,
    p_email: opts.email,
    p_via: opts.via,
    p_role: opts.role ?? "member",
    p_invite_code: opts.seatCode ?? null,
    p_invited_by: opts.invitedBy ?? null,
  } as never);
  if (error) {
    console.error("[Orgs] RPC api_org_join error:", error);
    return { ok: false, error_code: "server_error" };
  }
  const res = (data ?? {}) as { ok?: boolean; member_id?: string; already_member?: boolean; error_code?: JoinErrorCode };
  if (!res.ok || !res.member_id) return { ok: false, error_code: res.error_code ?? "server_error" };
  return { ok: true, memberId: res.member_id, alreadyMember: Boolean(res.already_member) };
}

/** Ends membership and revokes the member's org keys (one transaction). */
export async function removeOrgMember(
  orgId: string,
  userId: string,
  removedBy: string | null,
): Promise<{ ok: true; keysRevoked: number } | { ok: false; error_code: JoinErrorCode }> {
  const { data, error } = await getSupabase().rpc("api_org_remove_member", {
    p_org_id: orgId,
    p_user_id: userId,
    p_removed_by: removedBy,
  } as never);
  if (error) {
    console.error("[Orgs] RPC api_org_remove_member error:", error);
    return { ok: false, error_code: "server_error" };
  }
  const res = (data ?? {}) as { ok?: boolean; keys_revoked?: number; error_code?: JoinErrorCode };
  if (!res.ok) return { ok: false, error_code: res.error_code ?? "server_error" };
  return { ok: true, keysRevoked: Number(res.keys_revoked ?? 0) };
}

/** Resolve a seat code to its org id (the RPC re-validates the code under lock). */
export async function findOrgIdBySeatCode(code: string): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  if (normalized.length < 6 || normalized.length > 32) return null;
  const { data } = await getSupabase()
    .from("api_org_invites")
    .select("org_id")
    .eq("code", normalized)
    .maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export interface UserOrgSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole | null;
  /** member = already in; joinable = verified email domain is on the allowlist. */
  relation: "member" | "joinable";
  active: boolean;
  expires_at: string | null;
  /** Admins only. */
  balance_usd?: number;
  daily_spend_cap_usd?: number | null;
  daily_spend_today_usd?: number;
}

/** Orgs the user belongs to, plus orgs their verified email domain may join. */
export async function listOrgsForUser(user: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}): Promise<UserOrgSummary[]> {
  const sb = getSupabase();
  const { data: memberships } = await sb
    .from("api_org_members")
    .select("org_id, role, removed_at")
    .eq("user_id", user.id);
  const rows = (memberships ?? []) as { org_id: string; role: string; removed_at: string | null }[];
  const activeIds = rows.filter((m) => !m.removed_at).map((m) => m.org_id);
  const anyRowIds = new Set(rows.map((m) => m.org_id));

  const out: UserOrgSummary[] = [];
  if (activeIds.length > 0) {
    const { data: orgs } = await sb.from("api_orgs").select(ORG_COLUMNS).in("id", activeIds);
    for (const org of (orgs ?? []) as OrgRow[]) {
      const role: OrgRole = rows.find((m) => m.org_id === org.id)?.role === "admin" ? "admin" : "member";
      out.push({
        id: org.id,
        slug: org.slug,
        name: org.name,
        role,
        relation: "member",
        active: orgInactiveReason(org) === null,
        expires_at: org.expires_at,
        ...(role === "admin"
          ? {
              balance_usd: num(org.balance_usd),
              daily_spend_cap_usd: orgDailyCap(org),
              daily_spend_today_usd: orgDailySpendToday(org),
            }
          : {}),
      });
    }
  }

  const domain = emailDomain(user.email);
  if (domain && user.email_confirmed_at) {
    const { data: joinable } = await sb
      .from("api_orgs")
      .select(ORG_COLUMNS)
      .contains("allowed_email_domains", [domain]);
    for (const org of (joinable ?? []) as OrgRow[]) {
      // A former member cannot self-rejoin, so it is not offered.
      if (anyRowIds.has(org.id)) continue;
      if (orgInactiveReason(org) !== null) continue;
      out.push({
        id: org.id,
        slug: org.slug,
        name: org.name,
        role: null,
        relation: "joinable",
        active: true,
        expires_at: org.expires_at,
      });
    }
  }
  return out;
}

const JOIN_ERROR_STATUS: Record<JoinErrorCode, number> = {
  email_not_verified: 403,
  domain_not_allowed: 403,
  removed: 403,
  org_inactive: 403,
  not_member: 403,
  org_not_found: 404,
  invalid_code: 404,
  code_expired: 410,
  code_full: 409,
  seat_limit_reached: 409,
  invalid_email: 400,
  invalid_via: 400,
  server_error: 500,
};

export function joinErrorStatus(code: JoinErrorCode): number {
  return JOIN_ERROR_STATUS[code] ?? 400;
}

/**
 * Resolve the org a new self-serve key should bill to, joining it first when
 * the caller is not yet a member: by seat code when one is given, otherwise by
 * verified email domain. Existing members pass straight through.
 */
export async function resolveOrgForNewKey(
  user: { id: string; email?: string | null; email_confirmed_at?: string | null },
  opts: { orgId?: string | null; seatCode?: string | null },
): Promise<{ ok: true; org: OrgRow; joined: boolean } | { ok: false; error_code: JoinErrorCode }> {
  const seatCode = opts.seatCode?.trim() || null;
  const orgId = opts.orgId?.trim() || (seatCode ? await findOrgIdBySeatCode(seatCode) : null);
  if (!orgId) return { ok: false, error_code: seatCode ? "invalid_code" : "org_not_found" };

  const org = await loadOrg(orgId);
  if (!org) return { ok: false, error_code: "org_not_found" };
  if (orgInactiveReason(org)) return { ok: false, error_code: "org_inactive" };

  if (await getActiveMembership(org.id, user.id)) {
    return { ok: true, org, joined: false };
  }

  if (seatCode) {
    if (!emailDomain(user.email)) return { ok: false, error_code: "invalid_email" };
    if (!user.email_confirmed_at) return { ok: false, error_code: "email_not_verified" };
    const joined = await joinOrg({
      orgId: org.id,
      userId: user.id,
      email: user.email as string,
      via: "seat_code",
      seatCode,
    });
    return joined.ok ? { ok: true, org, joined: true } : { ok: false, error_code: joined.error_code };
  }

  const eligible = domainJoinEligibility({
    org,
    email: user.email,
    emailConfirmed: Boolean(user.email_confirmed_at),
  });
  if (!eligible.ok) return eligible;
  const joined = await joinOrg({
    orgId: org.id,
    userId: user.id,
    email: user.email as string,
    via: "domain",
  });
  return joined.ok ? { ok: true, org, joined: true } : { ok: false, error_code: joined.error_code };
}

/** Key expiry for a new org key: one year, never past the org's own expiry. */
export function orgKeyExpiresAt(org: Pick<OrgRow, "expires_at">, now: Date = new Date()): string {
  const yearOut = now.getTime() + 365 * 24 * 60 * 60 * 1000;
  const orgEnd = org.expires_at ? new Date(org.expires_at).getTime() : NaN;
  return new Date(Number.isFinite(orgEnd) ? Math.min(yearOut, orgEnd) : yearOut).toISOString();
}
