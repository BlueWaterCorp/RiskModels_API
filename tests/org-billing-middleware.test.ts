/**
 * withBilling: an org key is checked and charged at the org; a personal key
 * (no org) takes exactly the path it took before and never reaches org code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  validation: {} as Record<string, unknown>,
  userBalance: 100,
  orgBalance: 100,
  orgDaily: { exceeded: false, currentSpend: 0, cap: null as number | null },
  deductOrgImpl: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/agent/api-keys", () => ({
  extractApiKey: (req: Request) =>
    req.headers.get("authorization")?.replace("Bearer ", "") ?? null,
  validateApiKey: vi.fn(async () => h.validation),
}));

vi.mock("@/lib/agent/billing", () => ({
  checkBalance: vi.fn(),
  deductBalance: vi.fn(async () => undefined),
  ensureMinimumBalanceForUserKeyHolder: vi.fn(async () => undefined),
  ensureStarterCredits: vi.fn(async () => undefined),
  getUserBalance: vi.fn(async () => h.userBalance),
  isGrandfathered: vi.fn(async () => false),
}));

vi.mock("@/lib/agent/orgs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/agent/orgs")>();
  return {
    ...real,
    loadOrg: vi.fn(async (id: string) => ({
      id,
      slug: "examplequant",
      name: "Example Quant",
      status: "active",
      billing_mode: "prepaid",
      license_tier: null,
      balance_usd: h.orgBalance,
      daily_spend_cap_usd: h.orgDaily.cap,
      daily_spend_usd: h.orgDaily.currentSpend,
      daily_spend_reset_at: new Date().toISOString(),
      expires_at: null,
      allowed_email_domains: ["examplequant.com"],
      seat_limit: null,
      key_rate_limit_per_minute: 60,
    })),
    getOrgBalance: vi.fn(async () => h.orgBalance),
    checkOrgDailySpendCap: vi.fn(async () => h.orgDaily),
    deductOrgBalance: vi.fn(async () =>
      h.deductOrgImpl ? h.deductOrgImpl() : { balanceAfterUsd: h.orgBalance },
    ),
  };
});

vi.mock("@/lib/agent/licensed-billing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/agent/licensed-billing")>();
  return { ...real, loadLicenseAccount: vi.fn(async () => ({ billingMode: "prepaid", licenseTier: null })) };
});

vi.mock("@/lib/agent/free-tier", () => ({
  checkFreeTierLimit: vi.fn(async () => ({ tier: "paid", can_proceed: true })),
  incrementFreeTierUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/agent/telemetry", () => ({
  generateRequestId: () => "req_test",
  logTelemetry: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/auth-helper", () => ({
  authenticateRequest: vi.fn(async () => ({ user: null, error: "none" })),
}));

vi.mock("@/lib/supabase/admin", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { monthly_spend_cap: null, daily_spend_cap: null, daily_spend_usd: 0 } }),
  };
  return { createAdminClient: () => ({ rpc: async () => ({ data: null }), from: () => chain }) };
});

import { NextRequest, NextResponse } from "next/server";
import { withBilling } from "@/lib/agent/billing-middleware";
import * as billing from "@/lib/agent/billing";
import * as orgs from "@/lib/agent/orgs";
import * as licensed from "@/lib/agent/licensed-billing";
import { logTelemetry } from "@/lib/agent/telemetry";

const handler = vi.fn(async () => NextResponse.json({ ok: true }));
const route = withBilling(handler, { capabilityId: "ticker-returns" });
const call = () =>
  route(
    new NextRequest("http://x/api/ticker-returns?ticker=NVDA", {
      headers: { authorization: "Bearer rm_agent_live_test_key" },
    }),
  );

const PERSONAL = {
  valid: true,
  userId: "user-1",
  keyId: "key-1",
  keyPrefix: "rm_agent_live_ab",
  rateLimit: 60,
  keyScope: null,
  dailySpendCapUsd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userBalance = 100;
  h.orgBalance = 100;
  h.orgDaily = { exceeded: false, currentSpend: 0, cap: null };
  h.deductOrgImpl = null;
});

describe("withBilling — personal key (no org)", () => {
  it("charges the user and never calls org code", async () => {
    h.validation = PERSONAL;
    const res = await call();
    expect(res.status).toBe(200);
    expect(billing.deductBalance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(billing.deductBalance).mock.calls[0][0]).toBe("user-1");
    expect(billing.ensureStarterCredits).toHaveBeenCalledWith("user-1");
    expect(licensed.loadLicenseAccount).toHaveBeenCalledWith("user-1");
    for (const fn of [orgs.loadOrg, orgs.getOrgBalance, orgs.checkOrgDailySpendCap, orgs.deductOrgBalance]) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(res.headers.get("X-Billed-To")).toBeNull();
    const telemetry = vi.mocked(logTelemetry).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect("org_id" in telemetry).toBe(false);
  });

  it("still returns 402 on an empty personal balance", async () => {
    h.validation = PERSONAL;
    h.userBalance = 0;
    const res = await call();
    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withBilling — org key", () => {
  const ORG_KEY = { ...PERSONAL, orgId: "org-eq" };

  it("charges the org, not the member", async () => {
    h.validation = ORG_KEY;
    h.userBalance = 0; // the member's own balance is irrelevant
    const res = await call();
    expect(res.status).toBe(200);
    expect(orgs.deductOrgBalance).toHaveBeenCalledTimes(1);
    const args = vi.mocked(orgs.deductOrgBalance).mock.calls[0];
    expect(args[0]).toBe("org-eq");
    expect(args[1]).toBe("user-1");
    expect(billing.deductBalance).not.toHaveBeenCalled();
    expect(billing.getUserBalance).not.toHaveBeenCalled();
    expect(billing.ensureStarterCredits).not.toHaveBeenCalled();
    expect(licensed.loadLicenseAccount).not.toHaveBeenCalled();
    expect(res.headers.get("X-Billed-To")).toBe("org");
    const telemetry = vi.mocked(logTelemetry).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(telemetry.org_id).toBe("org-eq");
  });

  it("returns 402 when the org balance is empty, before running the handler", async () => {
    h.validation = ORG_KEY;
    h.orgBalance = 0;
    h.userBalance = 1000;
    const res = await call();
    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
    expect(orgs.deductOrgBalance).not.toHaveBeenCalled();
  });

  it("enforces the org daily cap", async () => {
    h.validation = ORG_KEY;
    h.orgDaily = { exceeded: true, currentSpend: 49.99, cap: 50 };
    const res = await call();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body._agent.cap_source).toBe("org");
    expect(res.headers.get("X-Daily-Cap-Source")).toBe("org");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 402 when a concurrent member call exhausted the org at charge time", async () => {
    h.validation = ORG_KEY;
    h.deductOrgImpl = async () => {
      throw new orgs.OrgChargeError("insufficient_balance", { balanceUsd: 0 });
    };
    const res = await call();
    expect(res.status).toBe(402);
  });
});
