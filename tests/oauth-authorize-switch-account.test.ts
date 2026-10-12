import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const signOut = vi.fn();
let pendingCookieWrites: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: { cookies: { setAll: (c: unknown) => void } }) => ({
    auth: {
      signOut: async (args: unknown) => {
        const result = await signOut(args);
        if (!result?.error) opts.cookies.setAll(pendingCookieWrites);
        return result ?? { error: null };
      },
    },
  })),
}));

import { POST } from "@/app/api/oauth/authorize/switch-account/route";
import {
  authorizeReturnPath,
  isAuthorizeReturn,
  signInPathFor,
} from "@/lib/oauth/authorize-return";

const ORIGIN = "https://riskmodels.app";

const AUTHORIZE = {
  response_type: "code",
  client_id: "rmc_test_client",
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  scope: "riskmodels",
  state: "st-123/with+chars&=",
  resource: "https://riskmodels.app/api/mcp/openai",
};

function nextOf(location: string): string {
  const u = new URL(location, ORIGIN);
  expect(u.pathname).toBe("/get-key");
  return u.searchParams.get("next") ?? "";
}

function paramsOf(path: string): Record<string, string> {
  const u = new URL(path, ORIGIN);
  expect(u.pathname).toBe("/oauth/authorize");
  return Object.fromEntries(u.searchParams.entries());
}

describe("authorize return helpers", () => {
  it("keeps every authorize parameter, including resource", () => {
    expect(paramsOf(authorizeReturnPath(AUTHORIZE))).toEqual(AUTHORIZE);
    expect(paramsOf(authorizeReturnPath(new URLSearchParams(AUTHORIZE)))).toEqual(AUTHORIZE);
  });

  it("takes the first value of repeated params and drops unknown ones", () => {
    const path = authorizeReturnPath({ ...AUTHORIZE, state: ["a", "b"], next: "https://evil.example" });
    expect(paramsOf(path)).toEqual({ ...AUTHORIZE, state: "a" });
  });

  it("always returns to the fixed /oauth/authorize path", () => {
    expect(authorizeReturnPath({})).toBe("/oauth/authorize");
    expect(paramsOf(nextOf(signInPathFor(AUTHORIZE)))).toEqual(AUTHORIZE);
  });

  it("recognises authorize return paths only", () => {
    expect(isAuthorizeReturn("/oauth/authorize?client_id=x")).toBe(true);
    expect(isAuthorizeReturn("/oauth/authorize")).toBe(true);
    expect(isAuthorizeReturn("/oauth/authorizeX")).toBe(false);
    expect(isAuthorizeReturn("/get-key")).toBe(false);
    expect(isAuthorizeReturn(null)).toBe(false);
  });
});

function request(fields: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  const body = new URLSearchParams(fields);
  return new NextRequest(`${ORIGIN}/api/oauth/authorize/switch-account`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      host: "riskmodels.app",
      origin: ORIGIN,
      cookie: "sb-proj-auth-token=abc; other=1",
      ...headers,
    },
    body: body.toString(),
  });
}

describe("POST /api/oauth/authorize/switch-account", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
    pendingCookieWrites = [{ name: "sb-proj-auth-token", value: "", options: { path: "/", maxAge: 0 } }];
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("signs out this browser only and returns to sign-in with every authorize param", async () => {
    const res = await POST(request(AUTHORIZE));
    expect(res.status).toBe(303);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    const location = res.headers.get("location")!;
    expect(new URL(location).origin).toBe(ORIGIN);
    expect(paramsOf(nextOf(location))).toEqual(AUTHORIZE);
    const cleared = res.cookies.get("sb-proj-auth-token");
    expect(cleared?.value).toBe("");
    expect(res.cookies.get("other")).toBeUndefined();
  });

  it("still expires sb-* cookies when signOut fails", async () => {
    signOut.mockResolvedValue({ error: { message: "network" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(request(AUTHORIZE));
    expect(res.status).toBe(303);
    const cleared = res.cookies.get("sb-proj-auth-token");
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
    // Logs the error message only, never the user's identity.
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/@/);
    spy.mockRestore();
  });

  it("rejects a cross-site POST without signing out", async () => {
    const res = await POST(request(AUTHORIZE, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });
});
