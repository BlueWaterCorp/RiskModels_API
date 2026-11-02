import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// upsert(...) returns a builder whose .select() resolves to { data, error }.
const select = vi.fn();
const upsert = vi.fn((_row: Record<string, unknown>, _opts?: Record<string, unknown>) => ({ select }));
const from = vi.fn(() => ({ upsert }));
const sendFeedEarlyAccessEmail = vi.fn();
const getUser = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/feed-email", () => ({
  sendFeedEarlyAccessEmail: (...args: unknown[]) => sendFeedEarlyAccessEmail(...args),
}));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import { POST } from "@/app/api/feed-waitlist/route";

const URL = "http://localhost/api/feed-waitlist";

function request(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/feed-waitlist", () => {
  beforeEach(() => {
    select.mockReset().mockResolvedValue({ data: [], error: null });
    upsert.mockClear();
    sendFeedEarlyAccessEmail.mockReset().mockResolvedValue({ id: "email-1" });
    from.mockClear();
    getUser.mockReset().mockResolvedValue({ data: { user: null } });
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfter: 3600 });
  });

  it("stores a lowercased email with the optional fields", async () => {
    const res = await POST(
      request({
        email: "  Analyst@Example.COM ",
        name: "A. Analyst",
        company: "Example Capital",
        role: "PM",
        intended_use: "risk_portfolio",
        consent_feed_emails: true,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(from).toHaveBeenCalledWith("feed_waitlist");
    const [row, opts] = upsert.mock.calls[0];
    expect(row!).toMatchObject({
      email: "analyst@example.com",
      name: "A. Analyst",
      company: "Example Capital",
      role: "PM",
      intended_use: "risk_portfolio",
      consent_feed_emails: true,
      user_id: null,
      source: "security-master-feed",
    });
    expect(typeof row!.consented_at).toBe("string");
    expect(opts).toEqual({ onConflict: "email", ignoreDuplicates: true });
  });

  it("attaches the session user id when signed in", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    const res = await POST(request({ email: "a@example.com" }));
    expect(res.status).toBe(200);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      user_id: "user-123",
      consent_feed_emails: false,
      consented_at: null,
      intended_use: null,
    });
  });

  it("treats a duplicate email as success (ignoreDuplicates upsert)", async () => {
    const first = await POST(request({ email: "dup@example.com" }));
    const second = await POST(request({ email: "DUP@example.com" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing or malformed email", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ email: "not-an-email" }))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown intended_use", async () => {
    const res = await POST(request({ email: "a@example.com", intended_use: "trading" }));
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    expect((await POST(request("{nope"))).status).toBe(400);
  });

  it("returns success without writing when the honeypot is filled", async () => {
    const res = await POST(request({ email: "bot@example.com", website: "http://spam" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 429 when the IP is over the limit", async () => {
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 1200 });
    const res = await POST(request({ email: "a@example.com" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1200");
    expect(rateLimit).toHaveBeenCalledWith("feed-waitlist", "203.0.113.7", 10, 3600);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 503 when the store write fails", async () => {
    select.mockResolvedValue({ data: null, error: { message: 'relation "feed_waitlist" does not exist' } });
    const res = await POST(request({ email: "a@example.com" }));
    expect(res.status).toBe(503);
  });
  const newRow = (over: Record<string, unknown> = {}) => ({
    email: "new@example.com",
    name: "N. Ew",
    consent_feed_emails: true,
    unsubscribe_token: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f",
    unsubscribed_at: null,
    ...over,
  });

  it("sends one confirmation email for a new signup with consent", async () => {
    select.mockResolvedValue({ data: [newRow()], error: null });
    const res = await POST(request({ email: "new@example.com", name: "N. Ew", consent_feed_emails: true }));
    expect(res.status).toBe(200);
    expect(select).toHaveBeenCalledWith("email, name, consent_feed_emails, unsubscribe_token, unsubscribed_at");
    expect(sendFeedEarlyAccessEmail).toHaveBeenCalledTimes(1);
    expect(sendFeedEarlyAccessEmail.mock.calls[0][0]).toMatchObject({ email: "new@example.com" });
  });

  it("sends nothing for a new signup without consent", async () => {
    select.mockResolvedValue({ data: [newRow({ consent_feed_emails: false })], error: null });
    const res = await POST(request({ email: "new@example.com" }));
    expect(res.status).toBe(200);
    expect(sendFeedEarlyAccessEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a repeat signup (no row inserted)", async () => {
    select.mockResolvedValue({ data: [], error: null });
    const res = await POST(request({ email: "dup@example.com", consent_feed_emails: true }));
    expect(res.status).toBe(200);
    expect(sendFeedEarlyAccessEmail).not.toHaveBeenCalled();
  });

  it("still succeeds when the confirmation email fails", async () => {
    select.mockResolvedValue({ data: [newRow()], error: null });
    sendFeedEarlyAccessEmail.mockRejectedValue(new Error("resend_error: domain not verified"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(request({ email: "new@example.com", consent_feed_emails: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    errSpy.mockRestore();
  });
});
