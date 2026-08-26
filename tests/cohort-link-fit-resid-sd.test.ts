/**
 * H.147: `linked_beta_se` was never a standard error; the store now writes
 * `link_fit_resid_sd` and keeps the old name as a deprecated alias. Either
 * public name must resolve to the new plane first and fall back to the old
 * one on vintages that predate the rename.
 */
import { describe, expect, it } from "vitest";

import {
  COHORT_FACTOR_VARS,
  COHORT_REMOVED_VARS,
  isCohortNumericVar,
  storeNamesFor,
} from "@/lib/dal/cohort-zarr-reader";

describe("H.147 link_fit_resid_sd rename", () => {
  it("exposes the new name and no longer accepts the removed alias", () => {
    expect(COHORT_FACTOR_VARS).toContain("link_fit_resid_sd");
    expect(COHORT_FACTOR_VARS).not.toContain("linked_beta_se");
    expect(isCohortNumericVar("link_fit_resid_sd")).toBe(true);
    expect(isCohortNumericVar("linked_beta_se")).toBe(false);
  });

  it("reads the new plane first, then the pre-rename plane name", () => {
    expect(storeNamesFor("link_fit_resid_sd")).toEqual(["link_fit_resid_sd", "linked_beta_se"]);
  });

  it("leaves every other variable mapped to itself", () => {
    for (const v of COHORT_FACTOR_VARS) {
      if (v === "link_fit_resid_sd") continue;
      expect(storeNamesFor(v)).toEqual([v]);
    }
  });

  it("records the removal with its replacement and date", () => {
    expect(COHORT_REMOVED_VARS.linked_beta_se).toEqual({
      replacement: "link_fit_resid_sd",
      removed: "2026-08-25",
    });
  });
});
