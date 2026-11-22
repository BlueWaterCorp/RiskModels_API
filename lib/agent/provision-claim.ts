/**
 * Contact-email verification ("claim") for accounts created by
 * `POST /api/auth/provision`.
 *
 * Provisioning never creates an auth user under the caller-supplied address.
 * The account lives under a synthetic address; the supplied address is kept as
 * an unverified contact in `agent_accounts.signup_attribution` together with
 * the sha256 of a single-use token. The owner of the address confirms from an
 * emailed link. Confirming:
 *   - records the address as the verified `contact_email`,
 *   - moves the account from the free tier (100 requests/day, 10/minute) to
 *     the paid tier and raises its keys to 60/minute,
 *   - makes sure the one-time $20 starter credit is on the account.
 * It does not give the address a web login to the account and does not attach
 * the key to any existing account that uses the same address.
 *
 * No schema change: everything is stored in the existing jsonb column.
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import { ensureStarterCredits } from "@/lib/agent/billing";

export const CLAIM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SYNTHETIC_EMAIL_DOMAIN = "noreply.riskmodels.app";
export const FREE_TIER_RPM = 10;
export const PAID_TIER_RPM = 60;

/** Address the auth user is created under; never a caller-supplied value. */
export function syntheticAgentEmail(kind: "agent" | "agent-free"): string {
  return `${kind}+${randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** Discarded immediately: the synthetic user never signs in with a password. */
export function generateSecurePassword(): string {
  return randomBytes(32).toString("base64url");
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newClaimToken(now = Date.now()): {
  token: string;
  tokenHash: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashClaimToken(token),
    expiresAt: new Date(now + CLAIM_TOKEN_TTL_MS).toISOString(),
  };
}

const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;

/** Lowercased, trimmed address, or null when it is not a plausible email. */
export function normalizeContactEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Hash used as a rate-limit key so the address itself is never a Redis key. */
export function contactEmailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type Admin = { from: (table: string) => any };

export type ClaimResult =
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "already_verified" }
  /** Address confirmed; it already belongs to another account, so no upgrade. */
  | { status: "verified_existing_address"; agentName: string | null }
  | { status: "verified"; agentName: string | null; userId: string };

export type ClaimPreview =
  | { status: "invalid" | "expired" | "already_verified" }
  | { status: "pending"; agentName: string | null };

async function loadByToken(admin: Admin, token: string) {
  if (!token || token.length > 200) return null;
  const { data, error } = await admin
    .from("agent_accounts")
    .select("id, user_id, agent_name, signup_attribution")
    .eq("signup_attribution->>claim_token_hash", hashClaimToken(token))
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data as {
    id: string;
    user_id: string;
    agent_name: string | null;
    signup_attribution: Record<string, unknown> | null;
  };
}

function tokenState(sa: Record<string, unknown>, now: number): "pending" | "expired" | "done" {
  if (sa.claim_status !== "pending") return "done";
  const exp = typeof sa.claim_expires_at === "string" ? Date.parse(sa.claim_expires_at) : NaN;
  if (!Number.isFinite(exp) || exp <= now) return "expired";
  return "pending";
}

/** Read-only look at a token, for the confirmation page. Changes nothing. */
export async function previewClaim(admin: Admin, token: string, now = Date.now()): Promise<ClaimPreview> {
  const row = await loadByToken(admin, token);
  if (!row) return { status: "invalid" };
  const state = tokenState(row.signup_attribution ?? {}, now);
  if (state === "done") return { status: "already_verified" };
  if (state === "expired") return { status: "expired" };
  return { status: "pending", agentName: row.agent_name };
}

/** True when another account or profile already uses this address. */
async function addressBelongsElsewhere(admin: Admin, email: string, userId: string): Promise<boolean> {
  const pattern = escapeLike(email);
  const { data: acct, error: acctErr } = await admin
    .from("agent_accounts")
    .select("id")
    .ilike("contact_email", pattern)
    .neq("user_id", userId)
    .limit(1);
  // Cannot tell: treat as taken, so an error never hands out an upgrade.
  if (acctErr) return true;
  if (Array.isArray(acct) && acct.length > 0) return true;
  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", pattern)
    .neq("id", userId)
    .limit(1);
  if (profErr) return true;
  return Array.isArray(prof) && prof.length > 0;
}

/**
 * Confirm the contact address behind a claim token. Single use: the token hash
 * is cleared by a compare-and-set update, so a second submit (or a concurrent
 * one) lands on `already_verified`.
 */
export async function claimProvisionedAccount(
  admin: Admin,
  token: string,
  now = Date.now(),
): Promise<ClaimResult> {
  const row = await loadByToken(admin, token);
  if (!row) return { status: "invalid" };
  const sa = row.signup_attribution ?? {};
  const state = tokenState(sa, now);
  if (state === "done") return { status: "already_verified" };
  if (state === "expired") return { status: "expired" };

  const email = normalizeContactEmail(sa.unverified_contact_email);
  if (!email) return { status: "invalid" };

  const tokenHash = hashClaimToken(token);
  const taken = await addressBelongsElsewhere(admin, email, row.user_id);
  const verifiedAt = new Date(now).toISOString();
  const nextSa: Record<string, unknown> = {
    ...sa,
    claim_status: taken ? "verified_existing_address" : "verified",
    contact_verified_at: verifiedAt,
    verified_contact_email: email,
  };
  delete nextSa.claim_token_hash;
  delete nextSa.claim_expires_at;
  delete nextSa.unverified_contact_email;

  const patch: Record<string, unknown> = {
    signup_attribution: nextSa,
    updated_at: verifiedAt,
  };
  if (!taken) {
    patch.contact_email = email;
    patch.tier = "paid";
  }

  const { data: updated, error } = await admin
    .from("agent_accounts")
    .update(patch)
    .eq("id", row.id)
    .eq("signup_attribution->>claim_token_hash", tokenHash)
    .select("id");
  if (error) throw new Error(`claim update failed: ${error.message}`);
  if (!Array.isArray(updated) || updated.length === 0) return { status: "already_verified" };

  if (taken) return { status: "verified_existing_address", agentName: row.agent_name };

  const { error: keyErr } = await admin
    .from("agent_api_keys")
    .update({ rate_limit_per_minute: PAID_TIER_RPM })
    .eq("user_id", row.user_id)
    .eq("rate_limit_per_minute", FREE_TIER_RPM);
  if (keyErr) console.error("[provision-claim] key rate limit update failed:", keyErr.message);

  try {
    await ensureStarterCredits(row.user_id);
  } catch (e) {
    console.error("[provision-claim] starter credit failed:", e instanceof Error ? e.message : e);
  }
  return { status: "verified", agentName: row.agent_name, userId: row.user_id };
}
