/**
 * get_stock_commentary_bundle — chat reducer for a single name (M.14).
 *
 * The model used to fan get_risk_metrics + get_ticker_returns + get_rankings
 * for one stock. This tool is the one-pull substitute. compare_tickers stays
 * the two-or-more path.
 */

import { describe, expect, it } from "vitest";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { TOOL_MAP } from "@/lib/chat/tools";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";

type FnTool = Extract<ChatCompletionTool, { type: "function" }>;

describe("get_stock_commentary_bundle registry entry", () => {
  const def = TOOL_MAP["get_stock_commentary_bundle"];

  it("exists and bills under cohorts (same family as the HTTP bundle)", () => {
    expect(def).toBeDefined();
    expect(def.capabilityId).toBe("cohorts");
  });

  it("requires ticker; window is optional with a 252d default", () => {
    expect(def.argSchema.safeParse({ ticker: "NVDA" }).success).toBe(true);
    expect(def.argSchema.safeParse({ ticker: "NVDA", window: "252d" }).success).toBe(
      true,
    );
    expect(def.argSchema.safeParse({ ticker: "NVDA", window: "1y" }).success).toBe(
      false,
    );
    expect(def.argSchema.safeParse({}).success).toBe(false);
  });

  it("tells the model not to fan out the old three-call path", () => {
    const fn = (def.openaiTool as FnTool).function;
    expect(fn.description).toMatch(/Do not fan out get_risk_metrics/);
    expect(fn.description).toMatch(/compare_tickers/);
  });
});

describe("reducer routing in the public Performance block", () => {
  it("routes one name to the bundle and two names to compare_tickers", () => {
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND;
    delete process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH;
    const p = buildSystemPrompt("2026-08-12");
    expect(p).toContain("get_stock_commentary_bundle");
    expect(p).toMatch(/compare NVDA and AMD.*compare_tickers/s);
    expect(p).not.toMatch(/emit both `get_risk_metrics`/);
  });
});
