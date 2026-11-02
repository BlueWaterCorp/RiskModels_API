import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));
const getUser = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
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
    upsert.mockReset().mockResolvedValue({ error: null });
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
    expect(row).toMatchObject({
      email: "analyst@example.com",
      name: "A. Analyst",
      company: "Example Capital",
      role: "PM",
      intended_use: "risk_portfolio",
      consent_feed_emails: true,
      user_id: null,
      source: "security-master-feed",
    });
    expect(typeof row.consented_at).toBe("string");
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
    upsert.mockResolvedValue({ error: { message: 'relation "feed_waitlist" does not exist' } });
    const res = await POST(request({ email: "a@example.com" }));
    expect(res.status).toBe(503);
  });
});
