import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  data: [] as unknown,
  error: null as unknown,
}));
const from = vi.fn();
const sendFeedEarlyAccessEmail = vi.fn();
const sendFeedDeliveryConfirmation = vi.fn();
const rateLimit = vi.fn();
const afterTasks: Array<() => Promise<void> | void> = [];

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: (task: () => Promise<void> | void) => {
      afterTasks.push(task);
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("@/lib/feed-email", () => ({
  sendFeedEarlyAccessEmail: (...args: unknown[]) => sendFeedEarlyAccessEmail(...args),
  sendFeedDeliveryConfirmation: (...args: unknown[]) => sendFeedDeliveryConfirmation(...args),
}));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import * as route from "@/app/api/feed-waitlist/confirm/route";

const { POST } = route;
const TOKEN = "A".repeat(43);
const BASE = "http://localhost/api/feed-waitlist/confirm";
const confirmed = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  email: "owner@example.com",
  name: "O. Wner",
  unsubscribe_token: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f",
  purpose: "contact",
  feed_email: null,
  ...over,
});
const feedRow = { id: "row-2", email: "ops@example.com", name: null, unsubscribe_token: "9a8b7c6d-1d2a-4b5c-9e8f-0a1b2c3d4e5f" };
const jsonRequest = (token: unknown) =>
  new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });

/** rpc: the confirm call returns `first`; the delivery-address claim returns `claim`. */
function mockRpc(first: unknown, claim: unknown = []) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "feed_waitlist_confirm") return { data: first, error: null };
    if (fn === "feed_waitlist_claim_confirmation") return { data: claim, error: null };
    return { data: [], error: null };
  });
}

async function runAfter() {
  for (const task of afterTasks.splice(0)) await task();
}

describe("POST /api/feed-waitlist/confirm", () => {
  beforeEach(() => {
    rpc.mockClear();
    mockRpc([confirmed()]);
    from.mockClear();
    sendFeedEarlyAccessEmail.mockReset().mockResolvedValue({ id: "email-1" });
    sendFeedDeliveryConfirmation.mockReset().mockResolvedValue({ id: "email-2" });
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 29, retryAfter: 3600 });
    afterTasks.length = 0;
  });

  it("records consent through one atomic database call, matched by the token's hash", async () => {
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, purpose: "contact" });
    expect(rpc).toHaveBeenCalledWith("feed_waitlist_confirm", {
      p_token_hash: createHash("sha256").update(TOKEN).digest("hex"),
    });
    expect(from).not.toHaveBeenCalled(); // no separate table writes: consent is one SQL function
  });

  it("queues the welcome email for a confirmed contact, without awaiting the provider", async () => {
    sendFeedEarlyAccessEmail.mockImplementation(() => new Promise(() => {}));
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(200);
    expect(sendFeedEarlyAccessEmail).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
  });

  it("sends the welcome email to the contact once the queued task runs", async () => {
    await POST(jsonRequest(TOKEN));
    await runAfter();
    expect(sendFeedEarlyAccessEmail).toHaveBeenCalledTimes(1);
    expect(sendFeedEarlyAccessEmail.mock.calls[0]![0]).toMatchObject({
      email: "owner@example.com",
      consent_feed_emails: true,
      purpose: "contact",
    });
    expect(sendFeedDeliveryConfirmation).not.toHaveBeenCalled(); // no delivery address was asked for
  });

  describe("a contact that asked for a separate feed delivery address", () => {
    beforeEach(() => {
      rpc.mockClear();
      mockRpc([confirmed({ feed_email: "ops@example.com" })], [feedRow]);
    });

    it("asks that address to confirm for itself, only after the contact confirmed, via the throttled claim", async () => {
      await POST(jsonRequest(TOKEN));
      await runAfter();
      const claim = rpc.mock.calls.find(([fn]) => fn === "feed_waitlist_claim_confirmation")!;
      expect(claim[1]).toMatchObject({
        p_email: "ops@example.com",
        p_min_interval_seconds: 900,
        p_max_sends: 3,
        p_window_seconds: 86400,
        // A delivery address records no marketing, terms or referral: a planted opt-in is reset.
        p_from_submission: true,
        p_marketing_opt_in: false,
        p_terms_version: null,
        p_referred_by: null,
      });
      expect(claim[1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(sendFeedDeliveryConfirmation).toHaveBeenCalledTimes(1);
      const [target, token, requestedBy] = sendFeedDeliveryConfirmation.mock.calls[0]!;
      expect(target).toMatchObject({ email: "ops@example.com" });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(createHash("sha256").update(token).digest("hex")).toBe(claim[1].p_token_hash);
      expect(requestedBy).toEqual({ email: "owner@example.com", name: "O. Wner" });
    });

    it("sends the delivery confirmation after the response, never before it", async () => {
      sendFeedDeliveryConfirmation.mockImplementation(() => new Promise(() => {}));
      const res = await POST(jsonRequest(TOKEN));
      expect(res.status).toBe(200);
      expect(sendFeedDeliveryConfirmation).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledTimes(1); // only the confirm call ran inside the request
    });

    it("sends nothing to the delivery address when the claim matches no row (already confirmed, unsubscribed, throttled or capped)", async () => {
      mockRpc([confirmed({ feed_email: "ops@example.com" })], []);
      await POST(jsonRequest(TOKEN));
      await runAfter();
      expect(sendFeedDeliveryConfirmation).not.toHaveBeenCalled();
    });

    it("still welcomes the contact when the delivery claim fails, and logs no address", async () => {
      rpc.mockImplementation(async (fn: string) =>
        fn === "feed_waitlist_confirm"
          ? { data: [confirmed({ feed_email: "ops@example.com" })], error: null }
          : { data: null, error: { code: "XX000", message: "bad row (ops@example.com)" } },
      );
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await POST(jsonRequest(TOKEN))).status).toBe(200);
      await runAfter();
      expect(sendFeedEarlyAccessEmail).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("ops@example.com");
      spy.mockRestore();
    });
  });

  it("confirming a delivery address sends it no welcome and starts no further delivery request", async () => {
    mockRpc([confirmed({ email: "ops@example.com", purpose: "feed", name: null })]);
    const res = await POST(jsonRequest(TOKEN));
    expect(await res.json()).toEqual({ ok: true, purpose: "feed" });
    await runAfter();
    expect(sendFeedEarlyAccessEmail).not.toHaveBeenCalled();
    expect(sendFeedDeliveryConfirmation).not.toHaveBeenCalled();
  });

  it("accepts the token in the query string too", async () => {
    const res = await POST(new NextRequest(`${BASE}?token=${TOKEN}`, { method: "POST" }));
    expect(res.status).toBe(200);
  });

  it("returns 400 for an unknown, used, expired or unsubscribed row (the function returns nothing)", async () => {
    mockRpc([]);
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid or expired link");
    expect(afterTasks).toHaveLength(0);
  });

  it("rejects a missing or malformed token without touching the database", async () => {
    expect((await POST(jsonRequest("short"))).status).toBe(400);
    expect((await POST(jsonRequest(null))).status).toBe(400);
    expect((await POST(new NextRequest(BASE, { method: "POST" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 503 when the confirmation fails, and logs no token", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: `bad token ${TOKEN}` } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(jsonRequest(TOKEN))).status).toBe(503);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    spy.mockRestore();
  });

  it("logs a welcome-email failure without the recipient or token", async () => {
    sendFeedEarlyAccessEmail.mockRejectedValue(new Error(`validation_error: invalid to owner@example.com ${TOKEN}`));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(jsonRequest(TOKEN))).status).toBe(200);
    await runAfter();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("owner@example.com");
    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain("validation_error");
    spy.mockRestore();
  });

  it("returns 429 when the IP is over the limit", async () => {
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 900 });
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not support GET, so a link scanner cannot confirm anyone", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });
});
