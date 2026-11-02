import { describe, expect, it } from "vitest";
import { safeErrorCode } from "@/lib/safe-log";

const TOKEN = "deadbeef-dead-4bee-8eef-deadbeefdead";

describe("safeErrorCode", () => {
  it("returns allowlisted database codes and never the message", () => {
    expect(safeErrorCode({ code: "23505", message: "Key (email)=(a@b.com)" })).toBe("23505");
    expect(safeErrorCode({ code: "PGRST116", message: `no row for ${TOKEN}` })).toBe("PGRST116");
  });

  it("returns allowlisted provider codes from the resend-audit prefix", () => {
    expect(safeErrorCode(new Error("validation_error: invalid to a@b.com"))).toBe("validation_error");
  });

  it("returns allowlisted error class names", () => {
    expect(safeErrorCode(new TypeError(`fetch failed for https://x/?token=${TOKEN}`))).toBe("TypeError");
  });

  describe("identifier-shaped sentinels never pass through", () => {
    it("in `code`", () => {
      expect(safeErrorCode({ code: TOKEN })).toBe("unknown");
      expect(safeErrorCode({ code: "deadbeef" })).toBe("unknown");
      expect(safeErrorCode({ code: "mail.example.com" })).toBe("unknown");
      expect(safeErrorCode({ code: "sentinel_leak" })).toBe("unknown");
    });

    it("in a message prefix", () => {
      expect(safeErrorCode(new Error("deadbeef: failed"))).toBe("Error");
      expect(safeErrorCode(new Error(`${TOKEN}: failed`))).toBe("Error");
      expect(safeErrorCode(new Error("sentinel_leak: failed"))).toBe("Error");
    });

    it("in a custom error name", () => {
      const e = new Error("failed");
      e.name = "SecretToken";
      expect(safeErrorCode(e)).toBe("unknown");
      const f = new Error("deadbeef: failed");
      f.name = TOKEN;
      expect(safeErrorCode(f)).toBe("unknown");
    });
  });

  it("returns unknown for non-errors", () => {
    expect(safeErrorCode("a@b.com")).toBe("unknown");
    expect(safeErrorCode(null)).toBe("unknown");
    expect(safeErrorCode(undefined)).toBe("unknown");
  });
});
