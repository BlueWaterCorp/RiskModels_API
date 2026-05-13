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
    // Header + the unambiguous decline-and-redirect instruction.
    expect(prompt).toMatch(/What you must NOT fabricate/);
    expect(prompt).toMatch(/no tool that returns a fund's, ETF's, or filer's holdings/i);
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
});
