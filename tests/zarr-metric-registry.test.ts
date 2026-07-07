import { describe, expect, it } from "vitest";

import { getZarrSpec } from "@/lib/dal/zarr-metric-registry";

describe("zarr-metric-registry — Lstar metrics", () => {
  it("lstar_rr maps to residual_return at level='lstar'", () => {
    const spec = getZarrSpec("lstar_rr");
    expect(spec).toBeDefined();
    expect(spec).toMatchObject({
      role: "returns",
      zarrVar: "residual_return",
      level: "lstar",
    });
  });

  it("lstar_level uses returnsFlat role with 0→null sentinel", () => {
    const spec = getZarrSpec("lstar_level");
    expect(spec).toBeDefined();
    expect(spec).toMatchObject({
      role: "returnsFlat",
      zarrVar: "lstar_level",
      nullSentinel: 0,
    });
  });

  it("v4 stock_specific residual returns map to the new ds_erm3_returns levels", () => {
    expect(getZarrSpec("stock_specific_rr_l3")).toMatchObject({
      role: "returns",
      zarrVar: "residual_return",
      level: "stock_specific_l3",
    });
    expect(getZarrSpec("stock_specific_rr_lstar")).toMatchObject({
      role: "returns",
      zarrVar: "residual_return",
      level: "stock_specific_lstar",
    });
  });

  it("FF style cascade (l*_ff_*) is fully retired (H.81 v4 cutover + H.92 axis removal)", () => {
    // The H.81 v4 cutover removed the L*_ff_* vars from every zarr store and H.92
    // deprecated the axis=style L* surface, so no l*_ff_* key is registered —
    // neither the ER/HR cascade nor the returns levels.
    expect(getZarrSpec("l2_ff_smb_er" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_smb_er" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_hml_er" as never)).toBeUndefined();
    expect(getZarrSpec("l2_ff_mkt_hr" as never)).toBeUndefined();
    expect(getZarrSpec("l2_ff_smb_hr" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_mkt_hr" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_smb_hr" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_hml_hr" as never)).toBeUndefined();
    expect(getZarrSpec("l2_ff_smb_rr" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_smb_hml_rr" as never)).toBeUndefined();
    // Style exposure is still served — as the v4 diagnostic block.
    expect(getZarrSpec("style_er")).toMatchObject({
      role: "hedge",
      zarrVar: "Style_ER_lstar",
    });
    expect(getZarrSpec("style_er_l3")).toMatchObject({
      role: "hedge",
      zarrVar: "Style_ER_l3",
    });
  });
});
