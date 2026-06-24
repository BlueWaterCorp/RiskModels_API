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

  it("style cascade exposes FF HEDGE vars only (returns levels retired in v4)", () => {
    // ER/HR cascade survives (ds_erm3_hedge_weights still carries the FF hedge vars)…
    expect(getZarrSpec("l2_ff_smb_er")).toMatchObject({
      role: "hedge",
      zarrVar: "L2_ff_smb_ER",
    });
    expect(getZarrSpec("l3_ff_hml_er")).toMatchObject({
      role: "hedge",
      zarrVar: "L3_ff_hml_ER",
    });
    // …but the FF *returns* levels (l2_ff_smb / l3_ff_smb_hml) were retired by the
    // v4 producer, so the style-axis residual-return series is no longer registered.
    expect(getZarrSpec("l2_ff_smb_rr" as never)).toBeUndefined();
    expect(getZarrSpec("l3_ff_smb_hml_rr" as never)).toBeUndefined();
  });
});
