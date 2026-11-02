import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_TOKEN_RE,
  CONFIRM_TOKEN_TTL_MS,
  hashConfirmToken,
  newConfirmToken,
} from "@/lib/feed-token";

describe("feed confirmation tokens", () => {
  it("makes a 43-character url-safe token and stores only its sha256", () => {
    const { token, hash } = newConfirmToken();
    expect(token).toMatch(CONFIRM_TOKEN_RE);
    expect(token).toHaveLength(43);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).not.toContain(token);
    expect(hashConfirmToken(token)).toBe(hash);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newConfirmToken().token));
    expect(seen.size).toBe(500);
  });

  it("only accepts tokens of the right shape", () => {
    expect(CONFIRM_TOKEN_RE.test("A".repeat(43))).toBe(true);
    expect(CONFIRM_TOKEN_RE.test("A".repeat(42))).toBe(false);
    expect(CONFIRM_TOKEN_RE.test("A".repeat(44))).toBe(false);
    expect(CONFIRM_TOKEN_RE.test("A".repeat(42) + "=")).toBe(false);
    expect(CONFIRM_TOKEN_RE.test("a@b.com" + "A".repeat(36))).toBe(false);
  });

  it("limits how often and how many confirmation emails one address can be sent", () => {
    expect(CONFIRM_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(CONFIRM_MIN_INTERVAL_SEC).toBe(900);
    expect(CONFIRM_MAX_SENDS).toBe(3);
  });
});
