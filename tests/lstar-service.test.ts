import { describe, expect, it } from "vitest";

import {
  dispatchLstarResidualReturn,
  pickLstar,
  LSTAR_DEFAULT_THRESHOLD,
} from "@/lib/risk/lstar-service";

describe("pickLstar", () => {
  it("defaults to L1 when marginal ERs are below threshold", () => {
    expect(pickLstar(0.005, 0.008, LSTAR_DEFAULT_THRESHOLD)).toBe("L1");
  });

  it("chooses L2 when sector ER clears threshold but subsector does not", () => {
    expect(pickLstar(0.02, 0.005, LSTAR_DEFAULT_THRESHOLD)).toBe("L2");
  });

  it("chooses L3 when subsector ER clears threshold", () => {
    expect(pickLstar(0.005, 0.02, LSTAR_DEFAULT_THRESHOLD)).toBe("L3");
  });

  it("returns null when both ER inputs are missing", () => {
    expect(pickLstar(null, null, LSTAR_DEFAULT_THRESHOLD)).toBeNull();
  });
});

describe("dispatchLstarResidualReturn", () => {
  const row = { l1_rr: 0.01, l2_rr: 0.02, l3_rr: 0.03 };

  it("routes to the matching level residual return", () => {
    expect(dispatchLstarResidualReturn("L1", row)).toBe(0.01);
    expect(dispatchLstarResidualReturn("L2", row)).toBe(0.02);
    expect(dispatchLstarResidualReturn("L3", row)).toBe(0.03);
  });

  it("returns null when Lstar is undetermined", () => {
    expect(dispatchLstarResidualReturn(null, row)).toBeNull();
  });
});
