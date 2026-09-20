/**
 * The weekly hedge feed is entitled per account, not per tier.
 *
 * One call returns the entire cross-section including the subsector ETF legs,
 * so "premium" is the wrong control — it would admit anyone who upgrades. The
 * gate is an explicit allowlist plus the admin bearer, and it FAILS CLOSED: an
 * unset allowlist admits nobody. A config gap must never silently mean open.
 */

import { describe, expect, it } from "vitest";
import {
  isWeeklyHedgeAuthorized,
  parseAllowlist,
} from "@/lib/api/weekly-hedge-access";

const ENV = { WEEKLY_HEDGE_ALLOWED_ACCOUNTS: "acct_hull, acct_other", CRON_SECRET: "s3cret" };

describe("parseAllowlist", () => {
  it("splits on commas and whitespace and drops blanks", () => {
    expect([...parseAllowlist("a, b  c,,  d ")]).toEqual(["a", "b", "c", "d"]);
  });
  it("treats unset as empty", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist("   ").size).toBe(0);
  });
});

describe("isWeeklyHedgeAuthorized", () => {
  it("admits an allowlisted account", () => {
    expect(isWeeklyHedgeAuthorized({ userId: "acct_hull", authHeader: null, env: ENV })).toBe(true);
  });

  it("refuses an account that is not allowlisted", () => {
    expect(isWeeklyHedgeAuthorized({ userId: "acct_random", authHeader: null, env: ENV })).toBe(false);
  });

  it("admits the admin bearer with no account at all", () => {
    expect(
      isWeeklyHedgeAuthorized({ userId: undefined, authHeader: "Bearer s3cret", env: ENV }),
    ).toBe(true);
  });

  it("refuses a wrong bearer", () => {
    expect(
      isWeeklyHedgeAuthorized({ userId: "acct_random", authHeader: "Bearer nope", env: ENV }),
    ).toBe(false);
  });

  it("FAILS CLOSED when the allowlist is unset", () => {
    // The config-gap case. Unset must not mean everyone.
    expect(
      isWeeklyHedgeAuthorized({ userId: "acct_hull", authHeader: null, env: { CRON_SECRET: "s3cret" } }),
    ).toBe(false);
  });

  it("FAILS CLOSED when the allowlist is empty", () => {
    expect(
      isWeeklyHedgeAuthorized({
        userId: "acct_hull",
        authHeader: null,
        env: { WEEKLY_HEDGE_ALLOWED_ACCOUNTS: "  ", CRON_SECRET: "s3cret" },
      }),
    ).toBe(false);
  });

  it("does not admit an empty bearer when CRON_SECRET is unset", () => {
    // Guards `auth === "Bearer undefined"` and `secret === ""` style holes.
    expect(
      isWeeklyHedgeAuthorized({
        userId: undefined,
        authHeader: "Bearer ",
        env: { WEEKLY_HEDGE_ALLOWED_ACCOUNTS: "acct_hull" },
      }),
    ).toBe(false);
  });

  it("does not admit the literal string \"Bearer undefined\" when CRON_SECRET is unset", () => {
    // Without the `secret &&` guard the comparison interpolates to
    // "Bearer undefined", which a caller can simply send. Config absence must
    // not mint a working credential.
    expect(
      isWeeklyHedgeAuthorized({
        userId: undefined,
        authHeader: "Bearer undefined",
        env: { WEEKLY_HEDGE_ALLOWED_ACCOUNTS: "acct_hull" },
      }),
    ).toBe(false);
  });

  it("refuses a missing userId against a populated allowlist", () => {
    expect(isWeeklyHedgeAuthorized({ userId: undefined, authHeader: null, env: ENV })).toBe(false);
  });
});
