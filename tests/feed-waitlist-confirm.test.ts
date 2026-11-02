import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

// update(patch).eq(hash).eq(consent=false).is(unsubscribed_at, null).gt(expires, now).select() resolves to { data, error }.
const select = vi.fn();
const gt = vi.fn(() => ({ select }));
const is = vi.fn(() => ({ gt }));
const eqConsent = vi.fn(() => ({ is }));
const eqHash = vi.fn(() => ({ eq: eqConsent }));
const update = vi.fn((_patch: Record<string, unknown>) => ({ eq: eqHash }));
const from = vi.fn(() => ({ update }));
const sendFeedEarlyAccessEmail = vi.fn();
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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/feed-email", () => ({
  sendFeedEarlyAccessEmail: (...args: unknown[]) => sendFeedEarlyAccessEmail(...args),
}));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import * as route from "@/app/api/feed-waitlist/confirm/route";

const { POST } = route;
const TOKEN = "A".repeat(43);
const BASE = "http://localhost/api/feed-waitlist/confirm";
const row = (over: Record<string, unknown> = {}) => ({
  email: "owner@example.com",
  name: "O. Wner",
  consent_feed_emails: true,
  unsubscribe_token: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f",
  unsubscribed_at: null,
  ...over,
});
const jsonRequest = (token: unknown) =>
  new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });

async function runAfter() {
  for (const task of afterTasks.splice(0)) await task();
}

describe("POST /api/feed-waitlist/confirm", () => {
  beforeEach(() => {
    select.mockReset().mockResolvedValue({ data: [row()], error: null });
    for (const m of [gt, is, eqConsent, eqHash, update, from]) m.mockClear();
    sendFeedEarlyAccessEmail.mockReset().mockResolvedValue({ id: "email-1" });
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 29, retryAfter: 3600 });
    afterTasks.length = 0;
  });

  it("records consent only for a valid, unexpired token, matched by its hash", async () => {
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("feed_waitlist");
    const patch = update.mock.calls[0]![0];
    expect(patch).toMatchObject({ consent_feed_emails: true, confirm_token_hash: null, confirm_expires_at: null });
    expect(typeof patch.consented_at).toBe("string");
    expect(eqHash).toHaveBeenCalledWith("confirm_token_hash", createHash("sha256").update(TOKEN).digest("hex"));
    expect(eqConsent).toHaveBeenCalledWith("consent_feed_emails", false);
    expect(is).toHaveBeenCalledWith("unsubscribed_at", null);
    expect(gt.mock.calls[0]).toEqual(["confirm_expires_at", expect.any(String)]);
  });

  it("queues the welcome email after consent, without awaiting the provider", async () => {
    sendFeedEarlyAccessEmail.mockImplementation(() => new Promise(() => {}));
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(200);
    expect(sendFeedEarlyAccessEmail).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
  });

  it("sends the welcome email once the queued task runs", async () => {
    await POST(jsonRequest(TOKEN));
    await runAfter();
    expect(sendFeedEarlyAccessEmail).toHaveBeenCalledTimes(1);
    expect(sendFeedEarlyAccessEmail.mock.calls[0]![0]).toMatchObject({ email: "owner@example.com" });
  });

  it("accepts the token in the query string too", async () => {
    const res = await POST(new NextRequest(`${BASE}?token=${TOKEN}`, { method: "POST" }));
    expect(res.status).toBe(200);
  });

  it("returns 400 for an unknown, used, expired or unsubscribed row (the update matches nothing)", async () => {
    select.mockResolvedValue({ data: [], error: null });
    const res = await POST(jsonRequest(TOKEN));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid or expired link");
    expect(afterTasks).toHaveLength(0);
  });

  it("rejects a missing or malformed token without touching the table", async () => {
    expect((await POST(jsonRequest("short"))).status).toBe(400);
    expect((await POST(jsonRequest(null))).status).toBe(400);
    expect((await POST(new NextRequest(BASE, { method: "POST" }))).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 503 when the update fails, and logs no token", async () => {
    select.mockResolvedValue({ data: null, error: { code: "XX000", message: `bad token ${TOKEN}` } });
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
    expect(update).not.toHaveBeenCalled();
  });

  it("does not support GET, so a link scanner cannot confirm anyone", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });
});
