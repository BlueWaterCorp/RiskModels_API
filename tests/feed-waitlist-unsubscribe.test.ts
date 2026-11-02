import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// update(...).eq(...).is(...) resolves to { error }.
const is = vi.fn();
const eq = vi.fn(() => ({ is }));
const update = vi.fn((_patch: Record<string, unknown>) => ({ eq }));
const from = vi.fn(() => ({ update }));
const rateLimit = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
}));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import { POST } from "@/app/api/feed-waitlist/unsubscribe/route";

const TOKEN = "3F2B8C1E-1D2A-4B5C-9E8F-0A1B2C3D4E5F";
const BASE = "http://localhost/api/feed-waitlist/unsubscribe";

describe("POST /api/feed-waitlist/unsubscribe", () => {
  beforeEach(() => {
    is.mockReset().mockResolvedValue({ error: null });
    eq.mockClear();
    update.mockClear();
    from.mockClear();
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 29, retryAfter: 3600 });
  });

  it("unsubscribes from the RFC 8058 one-click form POST (token in the query)", async () => {
    const req = new NextRequest(`${BASE}?token=${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith("feed_waitlist");
    expect(typeof update.mock.calls[0]![0].unsubscribed_at).toBe("string");
    expect(eq).toHaveBeenCalledWith("unsubscribe_token", TOKEN.toLowerCase());
    expect(is).toHaveBeenCalledWith("unsubscribed_at", null);
  });

  it("unsubscribes from the page's JSON POST", async () => {
    const req = new NextRequest(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect((await POST(req)).status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing or malformed token without writing", async () => {
    const bad = new NextRequest(`${BASE}?token=not-a-uuid`, { method: "POST" });
    expect((await POST(bad)).status).toBe(400);
    const none = new NextRequest(BASE, { method: "POST" });
    expect((await POST(none)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 503 when the update fails", async () => {
    is.mockResolvedValue({ error: { message: "boom" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(new NextRequest(`${BASE}?token=${TOKEN}`, { method: "POST" }));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
  });

  it("returns 429 when the IP is over the limit", async () => {
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 900 });
    const res = await POST(new NextRequest(`${BASE}?token=${TOKEN}`, { method: "POST" }));
    expect(res.status).toBe(429);
    expect(update).not.toHaveBeenCalled();
  });
});
