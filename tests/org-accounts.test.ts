/**
 * Org accounts: key validation, membership and joining. Personal keys
 * (org_id NULL) must validate exactly as before and never touch org tables.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./helpers/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as any }));

// Modules cache the admin client, so delegate to whichever fake is current.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => fake.current.client.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.current.client.rpc(n, a),
  }),
}));

import { generateApiKey, validateApiKey } from "@/lib/agent/api-keys";
import {
  domainJoinEligibility,
  emailDomain,
  orgDailySpendToday,
  orgInactiveReason,
  orgKeyExpiresAt,
  removeOrgMember,
  resolveOrgForNewKey,
} from "@/lib/agent/orgs";

const ORG_ID = "org-eq";
const USER = "user-1";
const NOW_ISO = new Date().toISOString();

function org(over: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    slug: "examplequant",
    name: "Example Quant",
    status: "active",
    billing_mode: "prepaid",
    license_tier: null,
    balance_usd: 500,
    daily_spend_cap_usd: 50,
    daily_spend_usd: 0,
    daily_spend_reset_at: NOW_ISO,
    expires_at: null,
    allowed_email_domains: ["examplequant.com"],
    seat_limit: null,
    key_rate_limit_per_minute: 60,
    ...over,
  };
}

function keyRow(hash: string, over: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    user_id: USER,
    key_hash: hash,
    key_prefix: "rm_agent_live_ab",
    scopes: ["*"],
    rate_limit_per_minute: 60,
    revoked_at: null,
    expires_at: null,
    key_scope: null,
    daily_spend_cap_usd: null,
    last_used_at: NOW_ISO,
    org_id: null,
    ...over,
  };
}

describe("validateApiKey — personal keys unchanged", () => {
  it("validates a key with no org and reads no org table", async () => {
    const k = generateApiKey("live");
    fake.current = createFakeSupabase({ tables: { agent_api_keys: [keyRow(k.hashedKey)] } });
    const v = await validateApiKey(k.plainKey);
    expect(v).toEqual({
      valid: true,
      userId: USER,
      keyId: "key-1",
      keyPrefix: "rm_agent_live_ab",
      scopes: ["*"],
      rateLimit: 60,
      keyScope: null,
      dailySpendCapUsd: null,
    });
    expect(fake.current.touched("api_orgs")).toBe(false);
    expect(fake.current.touched("api_org_members")).toBe(false);
  });

  it("falls back to the original select when org_id does not exist yet", async () => {
    const k = generateApiKey("live");
    const row = keyRow(k.hashedKey);
    delete (row as Record<string, unknown>).org_id;
    fake.current = createFakeSupabase({
      tables: { agent_api_keys: [row] },
      missingColumns: { agent_api_keys: ["org_id"] },
    });
    const v = await validateApiKey(k.plainKey);
    expect(v.valid).toBe(true);
    expect(v.orgId).toBeUndefined();
  });
});

describe("validateApiKey — org keys", () => {
  let plain: string;
  beforeEach(() => {
    const k = generateApiKey("live");
    plain = k.plainKey;
    fake.current = createFakeSupabase({
      tables: {
        agent_api_keys: [keyRow(k.hashedKey, { org_id: ORG_ID })],
        api_orgs: [org()],
        api_org_members: [{ org_id: ORG_ID, user_id: USER, role: "member", removed_at: null }],
      },
    });
  });

  it("returns the org id for an active member", async () => {
    const v = await validateApiKey(plain);
    expect(v.valid).toBe(true);
    expect(v.orgId).toBe(ORG_ID);
  });

  it("rejects the key once the member is removed", async () => {
    fake.current.tables.api_org_members[0].removed_at = NOW_ISO;
    const v = await validateApiKey(plain);
    expect(v).toMatchObject({ valid: false, error: "Organization membership has ended" });
  });

  it("rejects the key once the org has expired", async () => {
    fake.current.tables.api_orgs[0].expires_at = "2020-01-01T00:00:00Z";
    const v = await validateApiKey(plain);
    expect(v).toMatchObject({ valid: false, error: "Organization access has expired" });
  });

  it("rejects the key when the org is suspended", async () => {
    fake.current.tables.api_orgs[0].status = "suspended";
    const v = await validateApiKey(plain);
    expect(v).toMatchObject({ valid: false, error: "Organization access is suspended" });
  });
});

describe("member removal", () => {
  it("calls api_org_remove_member and reports revoked keys", async () => {
    fake.current = createFakeSupabase({
      rpc: { api_org_remove_member: () => ({ data: { ok: true, keys_revoked: 2 } }) },
    });
    const r = await removeOrgMember(ORG_ID, USER, "admin-1");
    expect(r).toEqual({ ok: true, keysRevoked: 2 });
    expect(fake.current.rpcCalls("api_org_remove_member")[0].args).toEqual({
      p_org_id: ORG_ID,
      p_user_id: USER,
      p_removed_by: "admin-1",
    });
  });

  it("passes through not_member", async () => {
    fake.current = createFakeSupabase({
      rpc: { api_org_remove_member: () => ({ data: { ok: false, error_code: "not_member" } }) },
    });
    expect(await removeOrgMember(ORG_ID, USER, null)).toEqual({ ok: false, error_code: "not_member" });
  });
});

describe("domain allowlist", () => {
  const verified = { email_confirmed_at: NOW_ISO };

  it("rejects another domain without calling the join RPC", async () => {
    fake.current = createFakeSupabase({ tables: { api_orgs: [org()], api_org_members: [] } });
    const r = await resolveOrgForNewKey({ id: USER, email: "a@gmail.com", ...verified }, { orgId: ORG_ID });
    expect(r).toEqual({ ok: false, error_code: "domain_not_allowed" });
    expect(fake.current.rpcCalls("api_org_join")).toHaveLength(0);
  });

  it("rejects a look-alike domain", () => {
    const r = domainJoinEligibility({
      org: org(),
      email: "a@examplequant.com.evil.io",
      emailConfirmed: true,
    });
    expect(r).toEqual({ ok: false, error_code: "domain_not_allowed" });
  });

  it("rejects an unverified email even on the right domain", async () => {
    fake.current = createFakeSupabase({ tables: { api_orgs: [org()], api_org_members: [] } });
    const r = await resolveOrgForNewKey(
      { id: USER, email: "a@examplequant.com", email_confirmed_at: null },
      { orgId: ORG_ID },
    );
    expect(r).toEqual({ ok: false, error_code: "email_not_verified" });
    expect(fake.current.rpcCalls("api_org_join")).toHaveLength(0);
  });

  it("joins a verified email on the allowlisted domain", async () => {
    fake.current = createFakeSupabase({
      tables: { api_orgs: [org()], api_org_members: [] },
      rpc: { api_org_join: () => ({ data: { ok: true, member_id: "m-1", already_member: false } }) },
    });
    const r = await resolveOrgForNewKey(
      { id: USER, email: "Jane@ExampleQuant.com", ...verified },
      { orgId: ORG_ID },
    );
    expect(r).toMatchObject({ ok: true, joined: true });
    expect(fake.current.rpcCalls("api_org_join")[0].args).toMatchObject({
      p_org_id: ORG_ID,
      p_user_id: USER,
      p_via: "domain",
    });
  });

  it("a removed member cannot rejoin by domain (RPC refusal surfaces)", async () => {
    fake.current = createFakeSupabase({
      tables: { api_orgs: [org()], api_org_members: [] },
      rpc: { api_org_join: () => ({ data: { ok: false, error_code: "removed" } }) },
    });
    const r = await resolveOrgForNewKey({ id: USER, email: "a@examplequant.com", ...verified }, { orgId: ORG_ID });
    expect(r).toEqual({ ok: false, error_code: "removed" });
  });

  it("an existing member passes without a join", async () => {
    fake.current = createFakeSupabase({
      tables: {
        api_orgs: [org({ allowed_email_domains: [] })],
        api_org_members: [{ org_id: ORG_ID, user_id: USER, role: "member", removed_at: null }],
      },
    });
    const r = await resolveOrgForNewKey({ id: USER, email: "x@other.com", ...verified }, { orgId: ORG_ID });
    expect(r).toMatchObject({ ok: true, joined: false });
    expect(fake.current.rpcCalls("api_org_join")).toHaveLength(0);
  });

  it("a seat code joins regardless of domain", async () => {
    fake.current = createFakeSupabase({
      tables: {
        api_orgs: [org({ allowed_email_domains: [] })],
        api_org_members: [],
        api_org_invites: [{ org_id: ORG_ID, code: "EQ-SEATS-01" }],
      },
      rpc: { api_org_join: () => ({ data: { ok: true, member_id: "m-2" } }) },
    });
    const r = await resolveOrgForNewKey(
      { id: USER, email: "contractor@gmail.com", ...verified },
      { seatCode: "eq-seats-01" },
    );
    expect(r).toMatchObject({ ok: true, joined: true });
    expect(fake.current.rpcCalls("api_org_join")[0].args).toMatchObject({
      p_via: "seat_code",
      p_invite_code: "eq-seats-01",
    });
  });
});

describe("pure org rules", () => {
  it("emailDomain lower-cases and rejects malformed input", () => {
    expect(emailDomain(" A@ExampleQuant.COM ")).toBe("examplequant.com");
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("a@")).toBeNull();
  });

  it("orgInactiveReason: open, expired, unreadable expiry, suspended", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(orgInactiveReason({ status: "active", expires_at: null }, now)).toBeNull();
    expect(orgInactiveReason({ status: "active", expires_at: "2026-11-20T11:59:59Z" }, now)).toBe("expired");
    expect(orgInactiveReason({ status: "active", expires_at: "garbage" }, now)).toBe("expired");
    expect(orgInactiveReason({ status: "suspended", expires_at: null }, now)).toBe("suspended");
  });

  it("orgDailySpendToday resets on a new UTC day", () => {
    const now = new Date("2026-11-20T00:05:00Z");
    expect(orgDailySpendToday({ daily_spend_usd: 12, daily_spend_reset_at: "2026-11-20T00:01:00Z" }, now)).toBe(12);
    expect(orgDailySpendToday({ daily_spend_usd: 12, daily_spend_reset_at: "2026-11-19T23:59:00Z" }, now)).toBe(0);
  });

  it("orgKeyExpiresAt never runs past the org expiry", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    expect(orgKeyExpiresAt({ expires_at: "2027-01-31T23:59:59.999Z" }, now)).toBe("2027-01-31T23:59:59.999Z");
    expect(orgKeyExpiresAt({ expires_at: null }, now)).toBe("2027-11-20T00:00:00.000Z");
  });
});
