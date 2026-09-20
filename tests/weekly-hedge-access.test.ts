/**
 * The weekly hedge feed is entitled by the commercial relationship, not by tier.
 *
 * One call returns the whole cross-section including the subsector ETF legs,
 * which are proprietary curation — so capability tier ("premium") is the wrong
 * control, since it would admit anyone who upgrades. Institutional clients
 * already carry billing_mode=licensed with a license tier; that is the real
 * relationship and the gate keys off it.
 *
 * Everything not matched is refused. A config gap must never mean open.
 */

import { describe, expect, it } from "vitest";
import {
  isWeeklyHedgeAuthorized,
  parseAllowlist,
  ENTITLED_LICENSE_TIERS,
} from "@/lib/api/weekly-hedge-access";

const ENV = { WEEKLY_HEDGE_ALLOWED_ACCOUNTS: "acct_exception", CRON_SECRET: "s3cret" };
const base = {
  userId: "acct_x",
  billingMode: null,
  licenseTier: null,
  adminSecret: null,
  env: ENV,
};

describe("parseAllowlist", () => {
  it("splits on commas and whitespace and drops blanks", () => {
    expect([...parseAllowlist("a, b  c,,  d ")]).toEqual(["a", "b", "c", "d"]);
  });
  it("treats unset or blank as empty", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("   ").size).toBe(0);
  });
});

describe("licensed clients", () => {
  it("admits a licensed firm-tier account with NO configuration", () => {
    // Hull's shape. Works without any env var being set.
    expect(
      isWeeklyHedgeAuthorized({
        userId: "acct_hull",
        billingMode: "licensed",
        licenseTier: "firm",
        adminSecret: null,
        env: {},
      }),
    ).toBe(true);
  });

  it("is case- and whitespace-insensitive on the tier", () => {
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "licensed", licenseTier: " Firm " }),
    ).toBe(true);
  });

  it("refuses a licensed account on a tier that is not entitled", () => {
    // The other licensed account in the admin view is tier "production".
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "licensed", licenseTier: "production" }),
    ).toBe(false);
  });

  it("refuses a prepaid account even on a firm tier value", () => {
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "prepaid", licenseTier: "firm" }),
    ).toBe(false);
  });

  it("refuses a licensed account with no tier", () => {
    expect(isWeeklyHedgeAuthorized({ ...base, billingMode: "licensed", licenseTier: null })).toBe(false);
  });

  it("keeps the entitled tier list narrow", () => {
    // Widening this is an IP decision; the test exists so it cannot widen
    // quietly. "trial" was added deliberately for time-boxed enterprise
    // trials — it is safe to entitle because agent_accounts REQUIRES a
    // license_expires_at for that tier and an elapsed license reverts to
    // prepaid, so it cannot become permanent by being forgotten.
    expect([...ENTITLED_LICENSE_TIERS].sort()).toEqual(["firm", "trial"]);
  });
});

describe("explicit exceptions and admin", () => {
  it("admits an allowlisted account id", () => {
    expect(isWeeklyHedgeAuthorized({ ...base, userId: "acct_exception" })).toBe(true);
  });

  it("refuses an account that is neither licensed nor allowlisted", () => {
    expect(isWeeklyHedgeAuthorized({ ...base, userId: "acct_random" })).toBe(false);
  });

  it("admits the admin secret", () => {
    expect(isWeeklyHedgeAuthorized({ ...base, adminSecret: "s3cret" })).toBe(true);
  });

  it("refuses a wrong admin secret", () => {
    expect(isWeeklyHedgeAuthorized({ ...base, adminSecret: "nope" })).toBe(false);
  });

  it("does not admit the literal \"undefined\" when CRON_SECRET is unset", () => {
    // Without the `secret &&` guard this string would compare equal.
    expect(
      isWeeklyHedgeAuthorized({ ...base, adminSecret: "undefined", env: {} }),
    ).toBe(false);
  });

  it("FAILS CLOSED with no license, no allowlist and no secret", () => {
    expect(isWeeklyHedgeAuthorized({ ...base, env: {} })).toBe(false);
  });
});
