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
  // v1.1 sidecars: the i.i.d. forms the corrected statistics superseded, and
  // the correction factor applied.
  ["stock_specific_sharpe_se_iid_36m", "StockSpecific_SharpeSEiid36m_lstar"],
  ["stock_specific_psr_iid_36m", "StockSpecific_PSRiid36m_lstar"],
  ["stock_specific_lrv_ratio_36m", "StockSpecific_LRVRatio36m_lstar"],
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
    expect(ROUTE).toContain('contract: "skill-inference/1.1.0"');
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

describe("skill-inference v1.1", () => {
  it("ships the i.i.d. forms beside the corrected ones", () => {
    // The correction changed what the uncertainty MEANS while leaving the point
    // estimates alone. Serving only the new values under the old version string
    // is precisely the silent change these sidecars exist to prevent.
    for (const f of ["sharpe_se_iid_36m", "psr_iid_36m", "lrv_ratio_36m"]) {
      expect(ROUTE).toContain(`${f}: num(`);
    }
  });

  it("says which direction the correction ran", () => {
    // A ratio with no stated orientation is a number a consumer will guess at.
    expect(ROUTE).toContain("i.i.d. form");
    expect(ROUTE).toMatch(/conservative/);
  });

  it("forbids cherry-picking between the two forms", () => {
    const block = ROUTE.slice(ROUTE.indexOf("prohibited: ["));
    expect(block).toMatch(/mixing the corrected and i\.i\.d\. forms/);
    expect(block).toMatch(/more favourable/);
  });

  it("forbids a universe-scoped multiplicity badge on a single-name answer", () => {
    // Screening 2,500 names and taking the winner is not the same problem as
    // asking about one name a priori, so one badge cannot serve both. On the
    // current panel zero names survive search adjustment while 232 clear the
    // single-name threshold — the gap between those is the whole point.
    // Matched on contiguous spans: the prohibition is written across string
    // concatenation, so a regex spanning the break silently never fires.
    const block = ROUTE.slice(ROUTE.indexOf("prohibited: ["));
    expect(block).toMatch(/universe-scoped multiplicity badge/);
    expect(block).toMatch(/screening 2,500 names/);
  });
});
