import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: [] as unknown, error: null as unknown }));
const sendFeedDeliveryChangeConfirmation = vi.fn();
const askDeliveryAddressToConfirm = vi.fn();
const rateLimit = vi.fn();
const afterTasks: Array<() => Promise<void> | void> = [];

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (task: () => Promise<void> | void) => void afterTasks.push(task) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/feed-email", () => ({
  sendFeedDeliveryChangeConfirmation: (...a: unknown[]) => sendFeedDeliveryChangeConfirmation(...a),
}));
vi.mock("@/lib/feed-delivery", () => ({
  askDeliveryAddressToConfirm: (...a: unknown[]) => askDeliveryAddressToConfirm(...a),
}));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...a: unknown[]) => rateLimit(...a),
}));

import { POST as requestChange } from "@/app/api/feed-waitlist/delivery/route";
import { POST as confirmChange } from "@/app/api/feed-waitlist/delivery/confirm/route";

const TOKEN = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const CONFIRM_TOKEN = "A".repeat(43);

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function runAfter() {
  for (const t of afterTasks.splice(0)) await t();
}

// The contact row shape feed_waitlist_claim_delivery_change returns (migration 20261113120000).
const claimed = {
  status: "claimed",
  id: "row-1",
  email: "conrad@bwmacro.com",
  name: "Conrad Gann",
  unsubscribe_token: TOKEN,
  delivery_change_email: "desk@example.com",
};

describe("POST /api/feed-waitlist/delivery (edition footer: send to a team inbox)", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
    sendFeedDeliveryChangeConfirmation.mockReset().mockResolvedValue({ id: "e1" });
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfter: 3600 });
    afterTasks.length = 0;
  });

  it("changes nothing itself: it emails the CONTACT a confirmation, through the atomic claim", async () => {
    rpc.mockResolvedValue({ data: [claimed], error: null });
    const res = await requestChange(post("/api/feed-waitlist/delivery", { token: TOKEN, feed_email: " Desk@Example.com ", stop_contact: true }));
    expect(res.status).toBe(200);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("feed_waitlist_claim_delivery_change");
    expect(args).toMatchObject({ p_unsubscribe_token: TOKEN, p_feed_email: "desk@example.com", p_stop_contact: true });
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc).toHaveBeenCalledTimes(1);
    await runAfter();
    const [row, token, change] = sendFeedDeliveryChangeConfirmation.mock.calls[0]!;
    expect(row.email).toBe("conrad@bwmacro.com");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(change).toEqual({ inbox: "desk@example.com", stopContact: true });
  });

  it("refuses, and says so, while an earlier request is still pending; never overwrites it", async () => {
    rpc.mockResolvedValue({ data: [{ status: "pending", id: null, email: null, name: null, unsubscribe_token: null, delivery_change_email: null }], error: null });
    const res = await requestChange(post("/api/feed-waitlist/delivery", { token: TOKEN, feed_email: "other@example.com" }));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("already waiting for confirmation");
    expect(afterTasks).toHaveLength(0);
  });

  it("gives the same reply when the claim matches nothing (unknown token, unconfirmed, throttled)", async () => {
    rpc.mockResolvedValue({ data: [{ status: "not_sent", id: null, email: null, name: null, unsubscribe_token: null, delivery_change_email: null }], error: null });
    const a = await requestChange(post("/api/feed-waitlist/delivery", { token: TOKEN, feed_email: "desk@example.com" }));
    rpc.mockResolvedValue({ data: [claimed], error: null });
    const b = await requestChange(post("/api/feed-waitlist/delivery", { token: TOKEN, feed_email: "desk@example.com" }));
    expect(await a.json()).toEqual(await b.json());
    afterTasks.length = 0;
  });

  it("rejects a bad token or address before touching the database", async () => {
    for (const body of [
      { token: "nope", feed_email: "desk@example.com" },
      { token: TOKEN, feed_email: "not-an-address" },
      { token: TOKEN },
    ]) {
      expect((await requestChange(post("/api/feed-waitlist/delivery", body))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 429 over the rate limit", async () => {
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 60 });
    expect((await requestChange(post("/api/feed-waitlist/delivery", { token: TOKEN, feed_email: "desk@example.com" }))).status).toBe(429);
  });
});

describe("POST /api/feed-waitlist/delivery/confirm", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
    askDeliveryAddressToConfirm.mockReset().mockResolvedValue("confirmation_sent");
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfter: 3600 });
    afterTasks.length = 0;
  });

  it("links the inbox in the database, then asks the inbox to confirm for itself", async () => {
    rpc.mockResolvedValue({
      data: [{ ...claimed, feed_email: "desk@example.com", linked: true }],
      error: null,
    });
    const res = await confirmChange(post("/api/feed-waitlist/delivery/confirm", { token: CONFIRM_TOKEN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc.mock.calls[0]![0]).toBe("feed_waitlist_confirm_delivery_change");
    expect(rpc.mock.calls[0]![1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    await runAfter();
    expect(askDeliveryAddressToConfirm.mock.calls[0]![1]).toBe("desk@example.com");
    expect(askDeliveryAddressToConfirm.mock.calls[0]![2]).toEqual({ email: "conrad@bwmacro.com", name: "Conrad Gann" });
  });

  it("gives the same reply when the address belongs to a contact, and sends nothing", async () => {
    rpc.mockResolvedValue({ data: [{ ...claimed, feed_email: "desk@example.com", linked: true }], error: null });
    const linked = await (await confirmChange(post("/api/feed-waitlist/delivery/confirm", { token: CONFIRM_TOKEN }))).json();
    afterTasks.length = 0;
    rpc.mockResolvedValue({ data: [{ ...claimed, feed_email: "someone@example.com", linked: false }], error: null });
    const notLinked = await (await confirmChange(post("/api/feed-waitlist/delivery/confirm", { token: CONFIRM_TOKEN }))).json();
    expect(notLinked).toEqual(linked);
    expect(afterTasks).toHaveLength(0);
  });

  it("answers 400 for an unknown, used or expired token, and for a malformed one without a lookup", async () => {
    expect((await confirmChange(post("/api/feed-waitlist/delivery/confirm", { token: CONFIRM_TOKEN }))).status).toBe(400);
    rpc.mockClear();
    expect((await confirmChange(post("/api/feed-waitlist/delivery/confirm", { token: "short" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 503 when the database call fails, without echoing it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "row conrad@bwmacro.com" } });
    const res = await confirmChange(post("/api/feed-waitlist/delivery/confirm", { token: CONFIRM_TOKEN }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("conrad@bwmacro.com");
    expect(JSON.stringify(err.mock.calls)).not.toContain("conrad@bwmacro.com");
    err.mockRestore();
  });
});
