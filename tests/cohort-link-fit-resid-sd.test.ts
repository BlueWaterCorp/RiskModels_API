/**
 * H.147: `linked_beta_se` was never a standard error; the store now writes
 * `link_fit_resid_sd` and keeps the old name as a deprecated alias. Either
 * public name must resolve to the new plane first and fall back to the old
 * one on vintages that predate the rename.
 */
import { describe, expect, it } from "vitest";

import {
  COHORT_DEPRECATED_VARS,
  COHORT_FACTOR_VARS,
  isCohortNumericVar,
  storeNamesFor,
} from "@/lib/dal/cohort-zarr-reader";

describe("H.147 link_fit_resid_sd rename", () => {
  it("exposes the new name and keeps the deprecated alias requestable", () => {
    expect(COHORT_FACTOR_VARS).toContain("link_fit_resid_sd");
    expect(COHORT_FACTOR_VARS).toContain("linked_beta_se");
    expect(isCohortNumericVar("link_fit_resid_sd")).toBe(true);
    expect(isCohortNumericVar("linked_beta_se")).toBe(true);
  });

  it("reads the new plane first for either public name, then the old one", () => {
    expect(storeNamesFor("link_fit_resid_sd")).toEqual(["link_fit_resid_sd", "linked_beta_se"]);
    expect(storeNamesFor("linked_beta_se")).toEqual(["link_fit_resid_sd", "linked_beta_se"]);
  });

  it("leaves every other variable mapped to itself", () => {
    for (const v of COHORT_FACTOR_VARS) {
      if (v === "link_fit_resid_sd" || v === "linked_beta_se") continue;
      expect(storeNamesFor(v)).toEqual([v]);
    }
  });

  it("declares the deprecation with its replacement and date", () => {
    expect(COHORT_DEPRECATED_VARS.linked_beta_se).toEqual({
      replacement: "link_fit_resid_sd",
      since: "2026-08-25",
    });
  });
});
