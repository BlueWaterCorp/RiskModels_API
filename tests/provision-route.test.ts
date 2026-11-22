import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb, type FakeDb } from "./fixtures/fake-supabase";

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  createUser: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  deleteUser: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  sendEmail: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  ensureStarterCredits: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => state.db.from(t),
    auth: { admin: { createUser: state.createUser, deleteUser: state.deleteUser } },
  }),
}));
vi.mock("@/lib/email-service", () => ({
  sendEmail: (...args: unknown[]) => state.sendEmail(...args),
}));
vi.mock("@/lib/agent/billing", () => ({
  ensureStarterCredits: (...args: unknown[]) => state.ensureStarterCredits(...args),
}));
vi.mock("@/lib/agent/affiliate", () => ({
  findActiveAffiliateByCode: async () => null,
  MAX_REFERRAL_CODE_LEN: 64,
}));

import { POST as provision } from "@/app/api/auth/provision/route";
import { POST as provisionFree } from "@/app/api/auth/provision-free/route";
import { GET as claimGet, POST as claimPost } from "@/app/api/auth/provision/claim/route";
import { hashApiKey, isValidApiKeyFormat } from "@/lib/agent/api-keys";
import { hashClaimToken } from "@/lib/agent/provision-claim";
import {
  PROVISION_DEGRADED_PER_HOUR,
  __resetProvisionRateLimitBackend,
} from "@/lib/agent/provision-rate-limit";
import { __resetMemoryRateLimits } from "@/lib/ratelimit/memory-fallback";

const CONTACT = "owner@example.com";

function post(url: string, body: unknown, ip: string | null = "203.0.113.7") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: JSON.stringify(body),
  });
}
const provisionReq = (over: Record<string, unknown> = {}, ip: string | null = "203.0.113.7") =>
  post(
    "https://riskmodels.app/api/auth/provision",
    { agent_name: "Research Bot", agent_id: "research-bot-1", contact_email: CONTACT, ...over },
    ip,
  );

/** The claim token never appears in the response; read it from the email the route sent. */
function tokenFromEmail(): string {
  const arg = state.sendEmail.mock.calls.at(-1)![0] as { data: { claimUrl: string } };
  return new URL(arg.data.claimUrl).searchParams.get("token")!;
}

let userSeq = 0;
const ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "STRIPE_SECRET_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetMemoryRateLimits();
  __resetProvisionRateLimitBackend();
  state.db = createFakeDb({
    unique: { agent_accounts: ["user_id", "agent_id"], agent_api_keys: ["key_hash"] },
  });
  state.createUser = vi.fn(async (attrs: { email: string }) => ({
    data: { user: { id: `${String(++userSeq).padStart(8, "0")}-0000-4000-8000-000000000000`, email: attrs.email } },
    error: null,
  }));
  state.deleteUser = vi.fn(async () => ({ error: null }));
  state.sendEmail = vi.fn(async () => ({ success: true, messageId: "m1" }));
  state.ensureStarterCredits = vi.fn(async () => "topped_up");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("POST /api/auth/provision", () => {
  it("returns a working key in one call, with no browser or captcha step", async () => {
    const res = await provision(provisionReq());
    expect(res.status).toBe(201);
    const body = await res.json();
    const key = body.credentials.api_key as string;
    expect(isValidApiKeyFormat(key)).toBe(true);
    // The stored row is the hash of exactly this key, active, at free-tier rate.
    const keys = state.db.table("agent_api_keys");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ key_hash: hashApiKey(key), rate_limit_per_minute: 10 });
    expect(keys[0]!.revoked_at ?? null).toBeNull();
    expect(body.account).toMatchObject({ status: "active", tier: "free", contact_email_status: "unverified" });
    expect(body.account.limits).toEqual({ queries_per_day: 100, queries_per_minute: 10 });
  });

  it("never creates an auth user under the supplied address", async () => {
    await provision(provisionReq());
    expect(state.createUser).toHaveBeenCalledTimes(1);
    const attrs = state.createUser.mock.calls[0]![0] as Record<string, any>;
    expect(attrs.email).toMatch(/^agent\+[0-9a-f-]{36}@noreply\.riskmodels\.app$/);
    expect(JSON.stringify(attrs)).not.toContain(CONTACT);
    expect(attrs.app_metadata).toEqual({ signup_site: "riskmodels.app" });
    // Password comes from crypto: 32 random bytes, base64url.
    expect(attrs.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stores the supplied address only as an unverified contact, on the free tier, with no balance", async () => {
    const res = await provision(provisionReq());
    const body = await res.json();
    const acct = state.db.table("agent_accounts")[0]!;
    expect(acct.contact_email).toMatch(/@noreply\.riskmodels\.app$/);
    expect(acct.tier).toBe("free");
    expect(acct.balance_usd).toBe(0);
    expect(acct.signup_attribution).toMatchObject({
      provisioned_via: "provision",
      ip: "203.0.113.7",
      unverified_contact_email: CONTACT,
      claim_status: "pending",
    });
    // Only the hash of the claim token is stored, and the token is not in the response.
    const token = tokenFromEmail();
    expect(acct.signup_attribution.claim_token_hash).toBe(hashClaimToken(token));
    expect(JSON.stringify(acct)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(state.ensureStarterCredits).not.toHaveBeenCalled();
  });

  it("sends the claim link to the supplied address and nowhere else", async () => {
    const res = await provision(provisionReq());
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    const arg = state.sendEmail.mock.calls[0]![0] as Record<string, any>;
    expect(arg.to).toBe(CONTACT);
    expect(arg.template).toBe("account-claim");
    expect(arg.data.claimUrl).toMatch(/^https:\/\/riskmodels\.app\/api\/auth\/provision\/claim\?token=/);
    expect((await res.json()).claim.email).toBe("sent");
  });

  it("an address that already has an account gets a separate account, never that account's key", async () => {
    // Existing human account under the same address, with its own key.
    state.db.table("agent_accounts").push({
      id: "acct-existing", user_id: "user-existing", agent_id: "starter_x", contact_email: CONTACT, balance_usd: 20, tier: "paid",
    });
    state.db.table("agent_api_keys").push({ id: "k-existing", user_id: "user-existing", key_hash: "existing-hash", key_prefix: "rm_agent_live_zz" });
    state.db.table("profiles").push({ id: "user-existing", email: CONTACT });

    const res = await provision(provisionReq());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.account.user_id).not.toBe("user-existing");
    expect(hashApiKey(body.credentials.api_key)).not.toBe("existing-hash");
    // The existing account and key are untouched.
    expect(state.db.table("agent_accounts").find((r) => r.id === "acct-existing")).toMatchObject({ balance_usd: 20, tier: "paid", user_id: "user-existing" });
    expect(state.db.table("agent_api_keys").filter((r) => r.user_id === "user-existing")).toHaveLength(1);

    // Even after the address owner confirms, the new account gets no upgrade or credit.
    const form = new FormData();
    form.set("token", tokenFromEmail());
    const claimed = await claimPost(new NextRequest("https://riskmodels.app/api/auth/provision/claim", { method: "POST", body: form }));
    expect(claimed.status).toBe(200);
    const fresh = state.db.table("agent_accounts").find((r) => r.user_id === body.account.user_id)!;
    expect(fresh.tier).toBe("free");
    expect(fresh.signup_attribution.claim_status).toBe("verified_existing_address");
    expect(state.ensureStarterCredits).not.toHaveBeenCalled();
  });

  it("rejects a duplicate agent_id without creating a user", async () => {
    await provision(provisionReq());
    const res = await provision(provisionReq({ contact_email: "other@example.com" }));
    expect(res.status).toBe(409);
    expect(state.createUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing email", { contact_email: undefined }],
    ["non-string name", { agent_name: { $ne: "" } }],
    ["bad email", { contact_email: "not-an-email" }],
    ["email with header injection", { contact_email: "a@b.co\r\nBcc: x@y.z" }],
    ["bad agent_id", { agent_id: "a b" }],
  ])("400 on %s, creating nothing", async (_l, over) => {
    const res = await provision(provisionReq(over));
    expect(res.status).toBe(400);
    expect(state.createUser).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("skips the claim email, but still issues the key, when that address was mailed today", async () => {
    await provision(provisionReq());
    const res = await provision(provisionReq({ agent_id: "research-bot-2" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim.email).toBe("not_sent_rate_limited");
    expect(isValidApiKeyFormat(body.credentials.api_key)).toBe(true);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("removes the auth user when the account insert fails", async () => {
    state.db = createFakeDb({ failing: { agent_api_keys: { message: "insert failed" } } });
    const res = await provision(provisionReq());
    expect(res.status).toBe(500);
    expect(state.deleteUser).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await res.json())).not.toContain("rm_agent_");
  });
});

describe("provisioning rate limit fails closed (limiter backend unavailable in this suite)", () => {
  it("provision: a new IP per request is still stopped at the shared limit", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR + 3; i++) {
      const res = await provision(provisionReq({ agent_id: `bot-${i}`, contact_email: `o${i}@example.com` }, `198.51.100.${i}`));
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(PROVISION_DEGRADED_PER_HOUR);
    expect(statuses.slice(PROVISION_DEGRADED_PER_HOUR)).toEqual([429, 429, 429]);
    expect(state.createUser).toHaveBeenCalledTimes(PROVISION_DEGRADED_PER_HOUR);
  });

  it("provision-free: unknown client IP is limited, not skipped", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR + 2; i++) {
      const res = await provisionFree(post("https://riskmodels.app/api/auth/provision-free", { agent_name: "free bot" }, null));
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(PROVISION_DEGRADED_PER_HOUR);
    expect(statuses.at(-1)).toBe(429);
    const last = await provisionFree(post("https://riskmodels.app/api/auth/provision-free", { agent_name: "free bot" }, null));
    expect(last.headers.get("retry-after")).toBeTruthy();
    expect((await last.json())._agent.limit_scope).toBe("shared_degraded");
  });

  it("both routes draw on the same allowance", async () => {
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR; i++) {
      await provisionFree(post("https://riskmodels.app/api/auth/provision-free", { agent_name: "free bot" }, `192.0.2.${i}`));
    }
    const res = await provision(provisionReq({}, "192.0.2.200"));
    expect(res.status).toBe(429);
    expect(state.createUser).toHaveBeenCalledTimes(PROVISION_DEGRADED_PER_HOUR);
  });

  it("provision-free still returns a working key in one call", async () => {
    const res = await provisionFree(post("https://riskmodels.app/api/auth/provision-free", { agent_name: "free bot" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(isValidApiKeyFormat(body.credentials.api_key)).toBe(true);
    expect(state.db.table("agent_accounts")[0]).toMatchObject({ tier: "free" });
  });

  it("refuses (503) when the durable per-IP count cannot be read", async () => {
    state.db = createFakeDb({ failing: { agent_accounts: { message: "db down" } } });
    const res = await provision(provisionReq());
    expect(res.status).toBe(503);
    expect(state.createUser).not.toHaveBeenCalled();
  });

  it("caps an IP at 3 accounts per day from the durable count, across both routes", async () => {
    for (let i = 0; i < 2; i++) {
      await provisionFree(post("https://riskmodels.app/api/auth/provision-free", { agent_name: "free bot" }));
    }
    expect((await provision(provisionReq())).status).toBe(201);
    const fourth = await provision(provisionReq({ agent_id: "research-bot-9" }));
    expect(fourth.status).toBe(429);
    expect((await fourth.json())._agent.limit_scope).toBe("per_ip");
  });
});

describe("claim link", () => {
  const claimUrl = (token: string) => `https://riskmodels.app/api/auth/provision/claim?token=${encodeURIComponent(token)}`;
  const submit = (token: string) => {
    const form = new FormData();
    form.set("token", token);
    return claimPost(new NextRequest("https://riskmodels.app/api/auth/provision/claim", { method: "POST", body: form }));
  };

  it("GET shows a confirm page and changes nothing (a mail scanner cannot confirm)", async () => {
    await provision(provisionReq());
    const token = tokenFromEmail();
    const res = await claimGet(new NextRequest(claimUrl(token)));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('method="post"');
    expect(html).toContain("Research Bot");
    expect(state.db.table("agent_accounts")[0]).toMatchObject({ tier: "free" });
    expect(state.db.table("agent_accounts")[0]!.signup_attribution.claim_status).toBe("pending");
    expect(state.ensureStarterCredits).not.toHaveBeenCalled();
  });

  it("POST verifies: paid tier, verified contact, 60/min keys, starter credit once", async () => {
    const created = await (await provision(provisionReq())).json();
    const token = tokenFromEmail();
    const res = await submit(token);
    expect(res.status).toBe(200);
    const acct = state.db.table("agent_accounts")[0]!;
    expect(acct).toMatchObject({ tier: "paid", contact_email: CONTACT });
    expect(acct.signup_attribution).toMatchObject({ claim_status: "verified", verified_contact_email: CONTACT });
    expect(acct.signup_attribution.claim_token_hash).toBeUndefined();
    expect(state.db.table("agent_api_keys")[0]!.rate_limit_per_minute).toBe(60);
    expect(state.ensureStarterCredits).toHaveBeenCalledTimes(1);
    expect(state.ensureStarterCredits).toHaveBeenCalledWith(created.account.user_id);

    // Single use.
    const again = await submit(token);
    expect(again.status).toBe(404);
    expect(state.ensureStarterCredits).toHaveBeenCalledTimes(1);
  });

  it("two simultaneous confirmations credit once", async () => {
    await provision(provisionReq());
    const token = tokenFromEmail();
    await Promise.all([submit(token), submit(token), submit(token)]);
    expect(state.ensureStarterCredits).toHaveBeenCalledTimes(1);
  });

  it("escapes the agent name on the confirm page", async () => {
    await provision(provisionReq({ agent_name: '<img src=x onerror="alert(1)">' }));
    const html = await (await claimGet(new NextRequest(claimUrl(tokenFromEmail())))).text();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("rejects an unknown token and an expired one", async () => {
    expect((await submit("nope")).status).toBe(404);
    expect((await claimGet(new NextRequest(claimUrl("nope")))).status).toBe(404);

    await provision(provisionReq());
    const token = tokenFromEmail();
    state.db.table("agent_accounts")[0]!.signup_attribution.claim_expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await submit(token)).status).toBe(410);
    expect(state.db.table("agent_accounts")[0]!.tier).toBe("free");
    expect(state.ensureStarterCredits).not.toHaveBeenCalled();
  });
});
