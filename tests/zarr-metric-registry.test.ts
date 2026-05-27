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
});
