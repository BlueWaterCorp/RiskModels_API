import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";

const fixtureDoctrinePath = path.join(process.cwd(), "tests/fixtures/analyst-doctrine-append.md");

const savedEnv = {
  APPEND: process.env.ANALYST_SYSTEM_PROMPT_APPEND,
  PATH: process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH,
};

function restoreEnv() {
  if (savedEnv.APPEND !== undefined) {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND = savedEnv.APPEND;
  } else {
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND;
  }
  if (savedEnv.PATH !== undefined) {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = savedEnv.PATH;
  } else {
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH;
  }
}

describe("buildSystemPrompt — contracted boundaries (fixture doctrine)", () => {
  beforeAll(() => {
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND;
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = fixtureDoctrinePath;
  });

  afterAll(() => {
    restoreEnv();
  });

  const prompt = () => buildSystemPrompt("2026-05-12");

  it("encodes the non-advisor boundary (THE_ANALYST §2)", () => {
    expect(prompt()).toMatch(/analyst, not an investment advisor/i);
    expect(prompt()).toMatch(/never recommend a specific trade, hedge, or rebalance/i);
    expect(prompt()).toMatch(/never assess.*suitable/i);
    expect(prompt()).toMatch(/not an investment adviser/i);
  });

  it("encodes the no-fabricated-portfolio rule (TA.NMD.1)", () => {
    expect(prompt()).toMatch(/What you must NOT fabricate/);
    expect(prompt()).toMatch(/two tool families/i);
    expect(prompt()).toMatch(/search_funds/);
    expect(prompt()).toMatch(/search_filers/);
    expect(prompt()).toMatch(/Even labeled-as-approximate fabrication is forbidden/i);
    expect(prompt()).toMatch(/Never fabricate portfolio composition/i);
  });

  it("encodes the Aha-first response shape (TA.M7.3)", () => {
    expect(prompt()).toMatch(/Response shape.*Aha first/);
    expect(prompt()).toMatch(/<details><summary>/);
    expect(prompt()).toMatch(/Lead with the Aha, not the table/);
  });

  it("frames hedge ratios as math, never as advice", () => {
    expect(prompt()).toMatch(/\$0\.62 of SPY per \$1 of portfolio neutralizes the market leg/);
  });

  it("warns against inferring market exposure from negative l3_market_hr alone", () => {
    expect(prompt()).toMatch(/never infer aggregate market stance from the sign of.*l3_market_hr/i);
    expect(prompt()).toMatch(/offsets market exposure already carried inside the sector/i);
  });

  it("includes the public shell identity line", () => {
    expect(prompt()).toMatch(/RiskModels AI Risk Analyst.*riskmodels\.app/s);
  });
});

describe("buildSystemPrompt — minimal doctrine fallback", () => {
  beforeAll(() => {
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND;
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH;
  });

  afterAll(() => {
    restoreEnv();
  });

  it("uses Operational baseline when doctrine env is unset", () => {
    const p = buildSystemPrompt("2026-05-12");
    expect(p).toMatch(/Operational baseline \(full institutional doctrine not loaded\)/);
    expect(p).not.toMatch(/You are an analyst, not an investment advisor — hard boundary/);
    expect(p).toMatch(/RiskModels AI Risk Analyst/s);
    expect(p).toMatch(/## Tools \(use them for live numbers\)/);
  });
});
