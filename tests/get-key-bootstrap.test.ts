import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb, type FakeDb } from "./fixtures/fake-supabase";

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as null | { id: string; email: string; app_metadata: Record<string, unknown> },
  updateUserById: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  sendEmail: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
}));

// billing.ts caches its admin client, so hand out one object that always
// reads the current fake database.
const adminProxy = {
  from: (t: string) => state.db.from(t),
  auth: {
    admin: {
      updateUserById: (...a: unknown[]) => state.updateUserById(...a),
      getUserById: async () => ({ data: { user: state.user }, error: null }),
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminProxy }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
}));
vi.mock("@/lib/email-service", () => ({ sendEmail: (...a: unknown[]) => state.sendEmail(...a) }));
vi.mock("@/lib/email-engagement", () => ({ saveSetup: async () => null }));
vi.mock("@/lib/agent/affiliate", () => ({
  findActiveAffiliateByCode: async () => null,
  MAX_REFERRAL_CODE_LEN: 64,
}));

import { POST } from "@/app/api/get-key/bootstrap/route";
import { GET as accountGet } from "@/app/api/account/route";
import { hashApiKey, isValidApiKeyFormat } from "@/lib/agent/api-keys";
import { isFirstKeyPlaceholder } from "@/lib/agent/first-key";

const USER = { id: "22222222-2222-4222-8222-222222222222", email: "new.user@example.com", app_metadata: {} };
const UTM = {
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "launch",
  utm_content: null,
  timestamp: "2026-11-01T10:00:00.000Z",
  referrer: "https://www.google.com/",
  landing_path: "/pricing",
};
const FIRST_LOAD = { gclid: "Gclid-1", utm: UTM, landing_path: "/pricing", referrer: "https://www.google.com/" };

const req = (body: unknown = {}) =>
  new NextRequest("https://riskmodels.app/api/get-key/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const accounts = () => state.db.table("agent_accounts");
const keys = () => state.db.table("agent_api_keys").filter((r) => !isFirstKeyPlaceholder(r));
const starterEvents = () => state.db.table("billing_events").filter((r) => r.capability_id === "starter_credit");

beforeEach(() => {
  state.db = createFakeDb({
    unique: { agent_accounts: ["user_id", "agent_id"], agent_api_keys: ["key_hash"] },
  });
  state.user = { ...USER };
  state.updateUserById = vi.fn(async () => ({ error: null }));
  state.sendEmail = vi.fn(async () => ({ success: true }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/get-key/bootstrap", () => {
  it("401 without a session, and creates nothing", async () => {
    state.user = null;
    const res = await POST(req(FIRST_LOAD));
    expect(res.status).toBe(401);
    expect(accounts()).toHaveLength(0);
    expect(keys()).toHaveLength(0);
  });

  it("first load: one call creates the account with $20 AND first-touch attribution, and issues the key", async () => {
    const res = await POST(req(FIRST_LOAD));
    expect(res.status).toBe(201);
    const body = await res.json();

    // Account: created by a single insert that already carries credit + attribution.
    const inserts = state.db.calls.filter((c) => c.table === "agent_accounts" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toMatchObject({
      user_id: USER.id,
      balance_usd: 20,
      signup_attribution: {
        gclid: "Gclid-1",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "launch",
        landing_path: "/pricing",
        referrer: "https://www.google.com/",
        channel: "ads",
      },
    });
    expect(state.db.calls.filter((c) => c.table === "agent_accounts" && c.op === "update")).toHaveLength(0);
    expect(starterEvents()).toHaveLength(1);
    expect(body.account).toBe("created");

    // Key: valid, returned once in plaintext, stored only as a hash.
    expect(body.key_status).toBe("issued");
    expect(isValidApiKeyFormat(body.key.plainKey)).toBe(true);
    expect(keys()).toHaveLength(1);
    expect(keys()[0]!.key_hash).toBe(hashApiKey(body.key.plainKey));
    expect(JSON.stringify(state.db.tables)).not.toContain(body.key.plainKey);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reload: no second key, no plaintext, no second credit", async () => {
    const first = await (await POST(req(FIRST_LOAD))).json();
    const res = await POST(req(FIRST_LOAD));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, account: "existing", key: null, key_status: "has_key" });
    expect(JSON.stringify(body)).not.toContain(first.key.plainKey);
    expect(keys()).toHaveLength(1);
    expect(accounts()).toHaveLength(1);
    expect(accounts()[0]!.balance_usd).toBe(20);
    expect(starterEvents()).toHaveLength(1);
  });

  it("two tabs at once: one account, one key, one plaintext, one starter credit", async () => {
    const results = await Promise.all([POST(req(FIRST_LOAD)), POST(req(FIRST_LOAD)), POST(req(FIRST_LOAD))]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(bodies.filter((b) => b.key?.plainKey)).toHaveLength(1);
    expect(keys()).toHaveLength(1);
    expect(state.db.table("agent_api_keys")).toHaveLength(1);
    expect(accounts()).toHaveLength(1);
    expect(accounts()[0]!.balance_usd).toBe(20);
    expect(starterEvents()).toHaveLength(1);
    // Key-issued email goes out once.
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a later load cannot overwrite first-touch gclid / utm / referrer / landing path", async () => {
    await POST(req(FIRST_LOAD));
    await POST(
      req({
        gclid: "Gclid-LATER",
        utm: { ...UTM, utm_source: "newsletter", utm_medium: "email", utm_campaign: "later", utm_content: "x", landing_path: "/get-key" },
        landing_path: "/get-key",
        referrer: "https://mail.example.com/",
      }),
    );
    expect(accounts()[0]!.signup_attribution).toMatchObject({
      gclid: "Gclid-1",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "launch",
      landing_path: "/pricing",
      referrer: "https://www.google.com/",
      channel: "ads",
    });
    // utm_content was vacant on the first touch and stays vacant: no splicing.
    expect(accounts()[0]!.signup_attribution.utm_content).toBeUndefined();
  });

  it("existing user with a key: nothing issued, balance untouched", async () => {
    accounts().push({ id: "a1", user_id: USER.id, agent_id: "starter_old", balance_usd: 7.5, signup_attribution: { channel: "organic" }, created_at: "2026-01-01T00:00:00.000Z" });
    state.db.table("agent_api_keys").push({ id: "k1", user_id: USER.id, key_hash: "old", key_prefix: "rm_agent_live_ab" });
    const body = await (await POST(req({}))).json();
    expect(body).toMatchObject({ account: "existing", key: null, key_status: "has_key" });
    expect(accounts()[0]!.balance_usd).toBe(7.5);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("marks signup_site when unset and leaves an existing value alone", async () => {
    await POST(req({}));
    expect(state.updateUserById).toHaveBeenCalledWith(USER.id, { app_metadata: { signup_site: "riskmodels.app" } });
    state.updateUserById.mockClear();
    state.user = { ...USER, app_metadata: { signup_site: "riskmodels.net" } };
    await POST(req({}));
    expect(state.updateUserById).not.toHaveBeenCalled();
  });

  it("ignores malformed attribution instead of storing it", async () => {
    await POST(req({ gclid: "<script>", utm: "nope", landing_path: "https://evil.com/x", referrer: "javascript:alert(1)" }));
    const sa = accounts()[0]!.signup_attribution ?? {};
    expect(sa.gclid).toBeUndefined();
    expect(sa.landing_path).toBeUndefined();
    expect(sa.referrer).toBeUndefined();
  });
});

describe("GET /api/account", () => {
  it("is read-only: it no longer creates the account", async () => {
    const res = await accountGet();
    expect(await res.json()).toBeNull();
    expect(accounts()).toHaveLength(0);
  });
});
