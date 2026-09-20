/**
 * A time-boxed license must end by itself.
 *
 * The 'trial' tier hands a prospect access to proprietary curation. If expiry
 * depended on someone remembering to revoke it, trials would become permanent
 * by attrition — so the database requires an end date (BWMACRO migration
 * 20260920120000) and this decides what an elapsed one means.
 */

import { describe, expect, it } from "vitest";
import { isLicenseExpired } from "@/lib/agent/licensed-billing";
import { ENTITLED_LICENSE_TIERS, isWeeklyHedgeAuthorized } from "@/lib/api/weekly-hedge-access";

const now = new Date("2026-09-20T12:00:00Z");

describe("isLicenseExpired", () => {
  it("treats NULL as open-ended — commercial tiers do not lapse", () => {
    expect(isLicenseExpired(null, now)).toBe(false);
    expect(isLicenseExpired(undefined, now)).toBe(false);
  });

  it("is live before the date", () => {
    expect(isLicenseExpired("2026-10-20T12:00:00Z", now)).toBe(false);
  });

  it("is expired after the date", () => {
    expect(isLicenseExpired("2026-09-19T12:00:00Z", now)).toBe(true);
  });

  it("is expired exactly at the boundary", () => {
    // Inclusive: a trial ending 'now' is over, not enjoying a final free call.
    expect(isLicenseExpired("2026-09-20T12:00:00Z", now)).toBe(true);
  });

  it("treats an unparseable date as EXPIRED, not live", () => {
    // Failing open here would silently extend access to proprietary data.
    expect(isLicenseExpired("not-a-date", now)).toBe(true);
    expect(isLicenseExpired("", now)).toBe(true);
  });
});

describe("trial entitlement to the weekly hedge feed", () => {
  const base = { userId: "acct_lisa", adminSecret: null, env: {} };

  it("entitles a live trial", () => {
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "licensed", licenseTier: "trial" }),
    ).toBe(true);
  });

  it("still entitles firm", () => {
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "licensed", licenseTier: "firm" }),
    ).toBe(true);
  });

  it("does not entitle an expired trial — loadLicenseAccount reverts it to prepaid", () => {
    // What the route sees once the date has passed.
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "prepaid", licenseTier: null }),
    ).toBe(false);
  });

  it("keeps the entitled tier list to firm and trial", () => {
    // Widening this is an IP decision; the test exists so it cannot widen quietly.
    expect([...ENTITLED_LICENSE_TIERS].sort()).toEqual(["firm", "trial"]);
  });

  it("still refuses production tier", () => {
    expect(
      isWeeklyHedgeAuthorized({ ...base, billingMode: "licensed", licenseTier: "production" }),
    ).toBe(false);
  });
});
