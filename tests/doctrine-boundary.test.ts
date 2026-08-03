import { describe, it, expect } from "vitest";
import { getMinimalOperationalDoctrine } from "../lib/chat/load-analyst-doctrine-append";

/**
 * The public fallback doctrine is guardrails, not interpretation.
 *
 * This repository is public. Until 2026-08-03 roughly twenty lines of
 * institutional interpretation lived in the fallback stub — which residual
 * measure to prefer and why the other overstates, how to render a hedge
 * basket, which endpoint to route each question shape to. It arrived because
 * the private doctrine channel was never wired (G.76), so the nuance went
 * where it would actually run, and it was still growing when it was found.
 *
 * `scripts/check-doctrine-boundary.sh` enforces the same rule in CI over the
 * source text. This test enforces it over the *rendered* string, which is
 * what actually reaches the model, and fails in a developer's own run rather
 * than only on a pushed branch.
 */

const doctrine = getMinimalOperationalDoctrine();

/** Judgments, not fields: a measure preference, a rendering rule, a routing decision. */
const INTERPRETIVE_MARKERS = [
  "lstar_rr",
  "l3_rr",
  "lstar_level",
  "decision_trace",
  "recommended_hedge_level",
  "get_hedge_basket",
  "get_industry_panel",
  "screen_rankings",
  "batch_lstar",
  "get_residual_signal_basket",
  "get_universe_members",
  "get_etf_factor_returns",
  "get_returns_decomposition",
  "Vasicek",
  "rank_ordinal",
  "mask_as_of",
];

describe("public fallback doctrine", () => {
  it("carries the guardrails that must survive a missing doctrine", () => {
    // These are safety and honesty, not interpretation. If the private
    // doctrine never loads, the analyst still must not advise, invent, or
    // emit markup the surface cannot render.
    expect(doctrine).toMatch(/Not an investment adviser/i);
    expect(doctrine).toMatch(/No fabrication/i);
    expect(doctrine).toMatch(/no LaTeX/i);
  });

  it("says out loud that it is running without the full doctrine", () => {
    // A thinner answer with no explanation is the failure this replaces.
    expect(doctrine).toMatch(/doctrine.*not loaded|not configured/i);
    expect(doctrine).toContain("ANALYST_SYSTEM_PROMPT_APPEND");
  });

  it("keeps the field contract, which a caller genuinely needs", () => {
    expect(doctrine).toMatch(/HR = dollar_ratio/);
    expect(doctrine).toMatch(/variance fractions/);
    // The sign guard is contract-shaped: it says how to read a field, not
    // which of two measures is the better evidence.
    expect(doctrine).toMatch(/never from the sign of an HR/i);
  });

  it.each(INTERPRETIVE_MARKERS)("does not name %s", (marker) => {
    expect(doctrine).not.toContain(marker);
  });

  it("stays within its size budget", () => {
    // The blocklist catches terms someone thought to add. The budget catches
    // the paragraph nobody thought to name.
    const lines = doctrine.trimEnd().split("\n").length;
    expect(lines).toBeLessThanOrEqual(20);
  });

  it("points at the private SSOT rather than restating it", () => {
    expect(doctrine).toContain(
      "chat_doctrine/ANALYST_SYSTEM_PROMPT_APPEND.md",
    );
  });
});
