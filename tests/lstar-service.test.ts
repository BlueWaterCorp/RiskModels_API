import { describe, expect, it } from "vitest";

import {
  dispatchLstarResidualReturn,
  dispatchStyleLstarResidualReturn,
  pickLstar,
  LSTAR_DEFAULT_THRESHOLD,
} from "@/lib/risk/lstar-service";

describe("pickLstar (industry)", () => {
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

  it("steps down when marginal ER is negative (subsector hurts)", () => {
    expect(pickLstar(0.02, -0.03, LSTAR_DEFAULT_THRESHOLD)).toBe("L2");
    expect(pickLstar(-0.06, 0.24, LSTAR_DEFAULT_THRESHOLD)).toBe("L3");
  });
});

describe("pickLstar (style axis)", () => {
  it("uses the same depth rule on SMB / HML marginal ERs", () => {
    expect(
      pickLstar(0.05, 0.16, LSTAR_DEFAULT_THRESHOLD, "style"),
    ).toBe("L3");
    expect(
      pickLstar(0.05, 0.005, LSTAR_DEFAULT_THRESHOLD, "style"),
    ).toBe("L2");
    expect(
      pickLstar(0.005, 0.005, LSTAR_DEFAULT_THRESHOLD, "style"),
    ).toBe("L1");
  });

  it("negative SMB marginal still allows L3 when HML clears (hierarchical)", () => {
    // BRK-B–like: smb −6%, hml +24% → style L3 under shared rule
    expect(
      pickLstar(-0.0625, 0.2445, LSTAR_DEFAULT_THRESHOLD, "style"),
    ).toBe("L3");
  });
});

describe("dispatchStyleLstarResidualReturn", () => {
  // v4 (stock_specific reset): the style-axis residual-return series was retired —
  // ds_erm3_returns no longer carries l2_ff_smb / l3_ff_smb_hml. Only L1 (market
  // residual) survives; L2/L3 return null (style is now a diagnostic ER/HR block).
  const row = { teo: "2026-01-01", l1_rr: 0.01 };

  it("returns the market residual at L1 and null at L2/L3 (style rr retired)", () => {
    expect(dispatchStyleLstarResidualReturn("L1", row)).toBe(0.01);
    expect(dispatchStyleLstarResidualReturn("L2", row)).toBeNull();
    expect(dispatchStyleLstarResidualReturn("L3", row)).toBeNull();
  });
});

describe("dispatchLstarResidualReturn", () => {
  const row = { teo: "2026-01-01", l1_rr: 0.01, l2_rr: 0.02, l3_rr: 0.03 };

  it("routes to the matching level residual return", () => {
    expect(dispatchLstarResidualReturn("L1", row)).toBe(0.01);
    expect(dispatchLstarResidualReturn("L2", row)).toBe(0.02);
    expect(dispatchLstarResidualReturn("L3", row)).toBe(0.03);
  });

  it("returns null when Lstar is undetermined", () => {
    expect(dispatchLstarResidualReturn(null, row)).toBeNull();
  });
});
