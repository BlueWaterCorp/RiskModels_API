import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const signInWithPassword = vi.fn();
const rateLimit = vi.fn();
let pendingCookieWrites: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];

vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.10",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: { cookies: { setAll: (c: unknown) => void } }) => ({
    auth: {
      signInWithPassword: async (args: unknown) => {
        const result = await signInWithPassword(args);
        if (!result?.error) opts.cookies.setAll(pendingCookieWrites);
        return result ?? { error: null };
      },
    },
  })),
}));

import { POST } from "@/app/api/oauth/authorize/password/route";

const ORIGIN = "https://riskmodels.app";

const AUTHORIZE = {
  response_type: "code",
  client_id: "rmc_test_client",
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  scope: "mcp:read",
  state: "st-123/with+chars&=",
  resource: "https://riskmodels.app/api/mcp/openai",
};

function request(fields: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  const body = new URLSearchParams(fields);
  return new NextRequest(`${ORIGIN}/api/oauth/authorize/password`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      host: "riskmodels.app",
      origin: ORIGIN,
      ...headers,
    },
    body: body.toString(),
  });
}

describe("POST /api/oauth/authorize/password", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    signInWithPassword.mockReset();
    signInWithPassword.mockResolvedValue({ error: null });
    rateLimit.mockReset();
    rateLimit.mockResolvedValue({ ok: true, remaining: 14, retryAfter: 900 });
    pendingCookieWrites = [{ name: "sb-proj-auth-token", value: "session", options: { path: "/" } }];
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("signs in and returns to authorize with the session cookie and no password in the URL", async () => {
    const res = await POST(request({ ...AUTHORIZE, email: "reviewer@riskmodels.app", password: "secret-value" }));
    expect(res.status).toBe(303);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "reviewer@riskmodels.app",
      password: "secret-value",
    });
    const location = res.headers.get("location")!;
    const u = new URL(location);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("login_error")).toBeNull();
    expect(u.searchParams.get("client_id")).toBe(AUTHORIZE.client_id);
    expect(u.searchParams.get("redirect_uri")).toBe(AUTHORIZE.redirect_uri);
    expect(u.searchParams.get("state")).toBe(AUTHORIZE.state);
    expect(location).not.toMatch(/secret-value|password=/);
    expect(res.cookies.get("sb-proj-auth-token")?.value).toBe("session");
  });

  it("returns a generic error and sets no session cookie when the password is wrong", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const res = await POST(request({ ...AUTHORIZE, email: "reviewer@riskmodels.app", password: "nope" }));
    expect(res.status).toBe(303);
    const u = new URL(res.headers.get("location")!);
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("login_error")).toBe("1");
    expect(u.searchParams.get("client_id")).toBe(AUTHORIZE.client_id);
    expect(res.headers.get("location")).not.toMatch(/nope|reviewer@/);
    expect(res.cookies.get("sb-proj-auth-token")).toBeUndefined();
  });

  it("does not call Supabase when the rate limit is exceeded", async () => {
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 900 });
    const res = await POST(request({ ...AUTHORIZE, email: "reviewer@riskmodels.app", password: "secret-value" }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).searchParams.get("login_error")).toBe("rate");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a cross-site POST", async () => {
    const res = await POST(request({ ...AUTHORIZE, email: "a@b.c", password: "x" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
