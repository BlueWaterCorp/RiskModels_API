/**
 * v4 `stock_specific.inference` leaf — SKILL_INFERENCE_CONTRACT_PHASE1 item 5.
 *
 * Wired ahead of enablement: the emission is config-gated OFF, so these serve
 * null until the Full run lands. That is the reserved-leaf pattern
 * `sharpe_36m` itself used, and wiring it now means enablement is a switch
 * rather than a second change.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const REGISTRY = readFileSync(
  join(process.cwd(), "lib/dal/zarr-metric-registry.ts"),
  "utf8",
);
const ENGINE = readFileSync(
  join(process.cwd(), "lib/dal/risk-engine-v3.ts"),
  "utf8",
);
const ROUTE = readFileSync(
  join(process.cwd(), "app/api/v4/decompose/route.ts"),
  "utf8",
);

const FIELDS = [
  ["stock_specific_sharpe_se_36m", "StockSpecific_SharpeSE36m_lstar"],
  ["stock_specific_psr_36m", "StockSpecific_PSR36m_lstar"],
  ["stock_specific_mintrl_36m", "StockSpecific_MinTRL36m_lstar"],
  ["stock_specific_n_36m", "StockSpecific_SharpeN36m_lstar"],
  ["stock_specific_tail_flag_36m", "StockSpecific_TailFlag36m_lstar"],
] as const;

describe("v4 skill-inference leaf", () => {
  it("maps every contract field to its zarr variable", () => {
    for (const [key, zarrVar] of FIELDS) {
      expect(REGISTRY).toContain(`${key}: { role: "hedge", zarrVar: "${zarrVar}" }`);
    }
  });

  it("declares each key on the metric union", () => {
    for (const [key] of FIELDS) expect(ENGINE).toContain(`| "${key}"`);
  });

  it("lists them as zarr overlay keys", () => {
    // Without this the zarr read never fires for a latest row lacking them, and
    // they serve permanently null even after the store carries them — the exact
    // bug that hit the v4 explained-variance scalars.
    const set = ENGINE.slice(
      ENGINE.indexOf("const STOCK_SPECIFIC_ZARR_OVERLAY_KEYS"),
      ENGINE.indexOf("]);", ENGINE.indexOf("const STOCK_SPECIFIC_ZARR_OVERLAY_KEYS")),
    );
    for (const [key] of FIELDS) expect(set).toContain(`"${key}"`);
  });

  it("requests them in the v4 route and returns them nested", () => {
    for (const [key] of FIELDS) expect(ROUTE).toContain(`"${key}"`);
    expect(ROUTE).toContain('contract: "skill-inference/1.0.0"');
  });

  it("nests them rather than flattening beside sharpe_36m", () => {
    // One contract, one version. A consumer must not lift the PSR out while
    // ignoring the tail flag that invalidates it.
    expect(ROUTE).toMatch(/inference:\s*\{/);
    expect(ROUTE).toMatch(/tail_flag_36m: num\(/);
  });

  it("ships the units, because a consumer that guesses is silently wrong", () => {
    expect(ROUTE).toContain("annualized, same scale as sharpe_36m");
    expect(ROUTE).toContain("fraction in [0,1]");
    expect(ROUTE).toContain("trading-day observations");
  });

  it("ships the prohibited framings alongside the numbers", () => {
    // §5. The most useful field in the fund manifest turned out to be the one
    // saying what a statistic may NOT be used to claim.
    const block = ROUTE.slice(ROUTE.indexOf("prohibited: ["));
    expect(block).toMatch(/forecast framing/);
    expect(block).toMatch(/superlatives/);
    expect(block).toMatch(/tail_flag_36m == 1/);
    expect(block).toMatch(/re-annualizing/);
  });
});
