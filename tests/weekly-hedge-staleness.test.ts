/**
 * The weekly pre-market hedge endpoint must refuse to serve an expired week.
 *
 * Context: the snapshot is built from a Friday close and is effective for the
 * following Monday-to-Friday. A caller pulling it before Monday's open cannot
 * tell last week's hedge ratios from this week's by inspection — they are the
 * same shape and the same names. So staleness has to be an error, not a value
 * the caller is trusted to check.
 *
 * This is not hypothetical: the publish step that produces this store reported
 * success for weeks while uploading nothing (ERM3 #250), which is the same
 * failure shape — a silent no-op that reads as healthy.
 */

import { describe, expect, it } from "vitest";
import { isStale, expectedEffectiveFrom } from "@/lib/risk/weekly-hedge-freshness";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("expectedEffectiveFrom", () => {
  it("rolls a Friday close to the following Monday", () => {
    expect(expectedEffectiveFrom("2026-09-18")).toBe("2026-09-21");
  });

  it("rolls a Thursday close to the Friday", () => {
    expect(expectedEffectiveFrom("2026-09-17")).toBe("2026-09-18");
  });

  it("returns null on an unparseable date rather than guessing", () => {
    expect(expectedEffectiveFrom("not-a-date")).toBeNull();
  });
});

describe("isStale", () => {
  it("is fresh on the Monday it is effective for", () => {
    expect(isStale("2026-09-21", at("2026-09-21"))).toBe(false);
  });

  it("is fresh through the Friday of its effective week", () => {
    expect(isStale("2026-09-21", at("2026-09-25"))).toBe(false);
  });

  it("is fresh over the weekend before the next snapshot lands", () => {
    expect(isStale("2026-09-21", at("2026-09-26"))).toBe(false);
  });

  it("is STALE once the following week has started", () => {
    expect(isStale("2026-09-21", at("2026-09-28"))).toBe(true);
  });

  it("is STALE a month later", () => {
    expect(isStale("2026-09-21", at("2026-10-21"))).toBe(true);
  });

  it("treats a missing effective_from as stale, not as fresh", () => {
    // The dangerous default. An absent attr must never read as current.
    expect(isStale(null, at("2026-09-21"))).toBe(true);
  });

  it("treats an unparseable effective_from as stale", () => {
    expect(isStale("garbage", at("2026-09-21"))).toBe(true);
  });
});
