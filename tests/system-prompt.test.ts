import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";

describe("buildSystemPrompt — contracted boundaries", () => {
  const prompt = buildSystemPrompt("2026-05-12");

  it("encodes the non-advisor boundary (THE_ANALYST §2)", () => {
    expect(prompt).toMatch(/analyst, not an investment advisor/i);
    expect(prompt).toMatch(/never recommend a specific trade, hedge, or rebalance/i);
    expect(prompt).toMatch(/never assess.*suitable/i);
    expect(prompt).toMatch(/not an investment adviser/i);
  });

  it("encodes the no-fabricated-portfolio rule (TA.NMD.1)", () => {
    // Header + the unambiguous decline-and-redirect instruction. After
    // PRs #83 (search_funds + get_fund_holdings) and #85 (search_filers
    // + get_filer_holdings) landed, the prompt copy was rewritten from
    // "no tool that returns a fund's, ETF's, or filer's holdings" to
    // "two tool families that return real holdings — use them before
    // declining." The decline-and-redirect rule still holds for the
    // off-panel case; this test asserts both the new tool-families
    // framing AND the unchanged hard-decline language.
    expect(prompt).toMatch(/What you must NOT fabricate/);
    expect(prompt).toMatch(/two tool families/i);
    expect(prompt).toMatch(/search_funds/);
    expect(prompt).toMatch(/search_filers/);
    expect(prompt).toMatch(/Even labeled-as-approximate fabrication is forbidden/i);
    expect(prompt).toMatch(/Never fabricate portfolio composition/i);
  });

  it("encodes the Aha-first response shape (TA.M7.3)", () => {
    expect(prompt).toMatch(/Response shape.*Aha first/);
    expect(prompt).toMatch(/<details><summary>/);
    expect(prompt).toMatch(/Lead with the Aha, not the table/);
  });

  it("frames hedge ratios as math, never as advice", () => {
    expect(prompt).toMatch(/\$0\.62 of SPY per \$1 of portfolio neutralizes the market leg/);
  });

  it("warns against inferring market exposure from negative l3_market_hr alone", () => {
    expect(prompt).toMatch(/never infer aggregate market stance from the sign of.*l3_market_hr/i);
    expect(prompt).toMatch(/offsets market exposure already carried inside the sector/i);
  });
});
