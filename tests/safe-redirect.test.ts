import { describe, expect, it } from "vitest";
import { safeRedirectPath, sanitizeRedirectPath } from "@/lib/auth/safe-redirect";

describe("sanitizeRedirectPath", () => {
  it.each([
    "/get-key",
    "/get-key?ref=abc&gclid=XYZ-1_2",
    "/account/usage",
    "/oauth/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=a%2Fb",
    "/docs/authentication#billing",
  ])("accepts same-origin path %s", (p) => {
    expect(sanitizeRedirectPath(p)).toBe(p);
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/get-key"],
    ["backslash host", "/\\evil.com"],
    ["double backslash", "\\\\evil.com"],
    ["encoded tab then slash", "/%09/evil.com"],
    ["literal tab then slash", "/\t/evil.com"],
    ["literal newline", "/\n/evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com/get-key"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,x"],
    ["encoded slashes", "/%2F%2Fevil.com"],
    ["encoded slash after slash", "/%2Fevil.com"],
    ["encoded backslash", "/%5Cevil.com"],
    ["double-encoded slash", "/%252Fevil.com"],
    ["encoded newline", "/%0a/evil.com"],
    ["backslash later in path", "/get-key\\@evil.com"],
    ["backslash in query", "/get-key?x=\\"],
    ["no leading slash", "get-key"],
    ["leading space", " /get-key"],
    ["empty", ""],
    ["malformed escape", "/%E0%A4%A"],
    ["null byte", "/get-key\u0000"],
  ])("rejects %s", (_label, p) => {
    expect(sanitizeRedirectPath(p)).toBeNull();
  });

  it("rejects non-strings and oversized values", () => {
    expect(sanitizeRedirectPath(null)).toBeNull();
    expect(sanitizeRedirectPath(undefined)).toBeNull();
    expect(sanitizeRedirectPath(42)).toBeNull();
    expect(sanitizeRedirectPath(`/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("safeRedirectPath", () => {
  it("falls back to /get-key by default", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/get-key");
    expect(safeRedirectPath(null)).toBe("/get-key");
  });
  it("uses the supplied fallback", () => {
    expect(safeRedirectPath("https://evil.com", "/")).toBe("/");
  });
  it("passes a safe path through", () => {
    expect(safeRedirectPath("/account/usage")).toBe("/account/usage");
  });
  it("a sanitized value always resolves to the page origin", () => {
    for (const p of ["/get-key", "/a/b?c=d", "//evil.com", "/\\evil.com", "/%09/evil.com", "https://evil.com"]) {
      const out = safeRedirectPath(p);
      expect(new URL(out, "https://riskmodels.app").origin).toBe("https://riskmodels.app");
    }
  });
});
