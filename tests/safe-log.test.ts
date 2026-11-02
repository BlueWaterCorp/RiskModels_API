import { describe, expect, it } from "vitest";
import { safeErrorCode } from "@/lib/safe-log";

describe("safeErrorCode", () => {
  it("returns a database error code and never the message", () => {
    expect(safeErrorCode({ code: "23505", message: "Key (email)=(a@b.com)" })).toBe("23505");
  });

  it("returns the provider code prefix from lib/resend-audit errors", () => {
    expect(safeErrorCode(new Error("validation_error: invalid to a@b.com"))).toBe("validation_error");
  });

  it("falls back to the error class name", () => {
    expect(safeErrorCode(new TypeError("fetch failed for https://x/?token=abc"))).toBe("TypeError");
  });

  it("returns unknown for anything else", () => {
    expect(safeErrorCode("a@b.com")).toBe("unknown");
    expect(safeErrorCode({ code: "a@b.com is not a code" })).toBe("unknown");
    expect(safeErrorCode(null)).toBe("unknown");
  });
});
