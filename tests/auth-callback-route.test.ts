import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  exchange: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  updateUserById: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  ensureAccount: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
  cookieNames: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => state.cookieNames.map((name) => ({ name, value: "v" })),
    set: () => {},
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: unknown[]) => void } }) => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        const result = await state.exchange(code);
        if (!result.error) {
          opts.cookies.setAll([{ name: "sb-proj-auth-token", value: "session", options: { path: "/" } }]);
        }
        return result;
      },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: state.updateUserById } }, from: () => ({}) }),
}));
vi.mock("@/lib/agent/account-bootstrap", async (orig) => {
  const actual = await orig<typeof import("@/lib/agent/account-bootstrap")>();
  return { ...actual, ensureAccountWithAttribution: (...a: unknown[]) => state.ensureAccount(...a) };
});

import { GET } from "@/app/auth/callback/route";

const ORIGIN = "https://riskmodels.app";
const call = (qs: string) => GET(new NextRequest(`${ORIGIN}/auth/callback?${qs}`));
const loc = (res: Response) => new URL(res.headers.get("location")!);
const user = (app_metadata: Record<string, unknown> = {}) => ({ id: "user-1", email: "u@example.com", app_metadata });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  state.cookieNames = ["sb-proj-auth-token-code-verifier"];
  state.exchange = vi.fn(async () => ({ data: { user: user(), session: { user: user() } }, error: null }));
  state.updateUserById = vi.fn(async () => ({ error: null }));
  state.ensureAccount = vi.fn(async () => ({ account: "created" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /auth/callback — redirect target", () => {
  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/%09/evil.com"],
    ["https://evil.com"],
    ["//evil.com/get-key"],
    ["/%2F%2Fevil.com"],
    ["evil.com"],
    ["javascript:alert(1)"],
  ])("next=%s lands on /get-key on this origin", async (next) => {
    const res = await call(`code=abc&next=${encodeURIComponent(next)}`);
    const u = loc(res);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/get-key");
    expect(res.headers.get("location")).not.toContain("evil.com");
  });

  it("follows a same-origin next and sets the session cookie", async () => {
    const res = await call(`code=abc&next=${encodeURIComponent("/oauth/authorize?client_id=c1&state=s")}`);
    const u = loc(res);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("c1");
    expect(res.cookies.get("sb-proj-auth-token")?.value).toBe("session");
  });

  it("defaults to /get-key", async () => {
    expect(loc(await call("code=abc")).pathname).toBe("/get-key");
  });
});

describe("GET /auth/callback — failures are reported to the page", () => {
  it("no code", async () => {
    const u = loc(await call("next=%2Fget-key"));
    expect(u.pathname).toBe("/get-key");
    expect(u.searchParams.get("error")).toBe("auth");
    expect(u.searchParams.get("reason")).toBe("failed");
  });

  it("Supabase otp_expired", async () => {
    const u = loc(await call("error=access_denied&error_code=otp_expired&error_description=x"));
    expect(u.searchParams.get("reason")).toBe("expired");
  });

  it("exchange fails with no PKCE verifier cookie: link opened in another browser", async () => {
    state.cookieNames = [];
    state.exchange = vi.fn(async () => ({ data: { user: null, session: null }, error: { message: "code verifier missing" } }));
    const res = await call("code=abc");
    const u = loc(res);
    expect(u.searchParams.get("error")).toBe("auth");
    expect(u.searchParams.get("reason")).toBe("other_device");
    expect(res.cookies.get("sb-proj-auth-token")).toBeUndefined();
  });

  it("exchange fails with the verifier present: expired or used", async () => {
    state.exchange = vi.fn(async () => ({ data: { user: null, session: null }, error: { message: "invalid grant" } }));
    expect(loc(await call("code=abc")).searchParams.get("reason")).toBe("expired");
  });

  it("keeps a safe next for the retry and never an unsafe one", async () => {
    const ok = loc(await call(`next=${encodeURIComponent("/oauth/authorize?client_id=c1")}`));
    expect(ok.searchParams.get("next")).toBe("/oauth/authorize?client_id=c1");
    const bad = loc(await call(`next=${encodeURIComponent("//evil.com")}`));
    expect(bad.searchParams.get("next")).toBeNull();
    expect(bad.origin).toBe(ORIGIN);
  });
});

describe("GET /auth/callback — signup_site", () => {
  it("writes app_metadata.signup_site when unset, keeping other app_metadata", async () => {
    state.exchange = vi.fn(async () => ({ data: { user: user({ provider: "google" }) }, error: null }));
    await call("code=abc");
    expect(state.updateUserById).toHaveBeenCalledWith("user-1", {
      app_metadata: { provider: "google", signup_site: "riskmodels.app" },
    });
  });

  it("never overwrites an existing value", async () => {
    state.exchange = vi.fn(async () => ({ data: { user: user({ signup_site: "riskmodels.net" }) }, error: null }));
    await call("code=abc");
    expect(state.updateUserById).not.toHaveBeenCalled();
  });

  it("a failed write does not fail sign-in", async () => {
    state.updateUserById = vi.fn(async () => {
      throw new Error("admin api down");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call("code=abc");
    expect(loc(res).pathname).toBe("/get-key");
    expect(res.cookies.get("sb-proj-auth-token")?.value).toBe("session");
  });
});

describe("GET /auth/callback — attribution carried on the callback URL", () => {
  it("going to /get-key: forwards the params for the page's one bootstrap call", async () => {
    const res = await call(
      `code=abc&next=${encodeURIComponent("/get-key?gclid=FIRST")}&gclid=LATER&utm_source=google&lp=${encodeURIComponent("/pricing")}`,
    );
    const u = loc(res);
    expect(u.pathname).toBe("/get-key");
    expect(u.searchParams.get("gclid")).toBe("FIRST"); // a value already on next is not replaced
    expect(u.searchParams.get("utm_source")).toBe("google");
    expect(u.searchParams.get("lp")).toBe("/pricing");
    expect(state.ensureAccount).not.toHaveBeenCalled();
  });

  it("going elsewhere: writes account + first touch server-side, with the real landing path", async () => {
    await call(
      `code=abc&next=${encodeURIComponent("/oauth/authorize?client_id=c1")}&gclid=Abc-1&utm_source=google&utm_medium=cpc&lp=${encodeURIComponent("/pricing")}`,
    );
    expect(state.ensureAccount).toHaveBeenCalledTimes(1);
    const touch = state.ensureAccount.mock.calls[0]![2] as Record<string, any>;
    expect(touch.gclid).toBe("Abc-1");
    expect(touch.landing_path).toBe("/pricing");
    expect(touch.utm).toMatchObject({ utm_source: "google", utm_medium: "cpc", landing_path: "/pricing" });
  });

  it("going elsewhere with nothing carried: writes nothing", async () => {
    await call(`code=abc&next=${encodeURIComponent("/oauth/authorize?client_id=c1")}`);
    expect(state.ensureAccount).not.toHaveBeenCalled();
  });
});
