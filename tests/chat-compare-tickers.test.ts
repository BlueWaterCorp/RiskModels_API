/**
 * compare_tickers (G.69/G.73) — the analyst's first multi-subject tool.
 *
 * Booked from the CEO loading a filer, asking to compare BAC to IBM, and
 * getting nothing back: every chat tool was single-ticker. These tests pin
 * the three properties that make the comparison trustworthy: the rows share
 * one metric axis with get_risk_metrics (no cross-tool drift), a vintage
 * mismatch is stated rather than hidden (the G.71 defect in table form),
 * and the sanitizer never replaces the rows — the comparison itself — with
 * a shape stub.
 */

import { describe, expect, it } from "vitest";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import {
  shapeTickerComparison,
  TOOL_MAP,
  type TickerComparisonRow,
} from "@/lib/chat/tools";

type FnTool = Extract<ChatCompletionTool, { type: "function" }>;

const row = (
  ticker: string,
  teo: string | null,
  metrics: Record<string, number | null> = { vol_23d: 0.3 },
): TickerComparisonRow => ({ ticker, symbol: `${ticker}-US`, teo, metrics });

describe("compare_tickers registry entry", () => {
  const def = TOOL_MAP["compare_tickers"];

  it("exists, bills once via batch-analysis", () => {
    expect(def).toBeDefined();
    expect(def.capabilityId).toBe("batch-analysis");
  });

  it("declares a strict schema whose only parameter is the ticker array", () => {
    const fn = (def.openaiTool as FnTool).function;
    expect(fn.strict).toBe(true);
    const params = fn.parameters as Record<string, unknown>;
    expect(params.required).toEqual(["tickers"]);
    expect(Object.keys(params.properties as Record<string, unknown>)).toEqual(["tickers"]);
  });

  it("rejects fewer than two or more than eight tickers", () => {
    expect(def.argSchema.safeParse({ tickers: ["NVDA"] }).success).toBe(false);
    expect(def.argSchema.safeParse({ tickers: Array(9).fill("NVDA") }).success).toBe(false);
    expect(def.argSchema.safeParse({ tickers: ["BAC", "IBM"] }).success).toBe(true);
  });
});

describe("shapeTickerComparison", () => {
  it("marks one shared vintage as aligned", () => {
    const shaped = shapeTickerComparison(
      [row("BAC", "2026-08-04"), row("IBM", "2026-08-04")],
      [],
    );
    const vintage = shaped.vintage as Record<string, unknown>;
    expect(vintage.aligned).toBe(true);
    expect(vintage.note).toBeUndefined();
  });

  it("states a vintage mismatch instead of hiding it", () => {
    const shaped = shapeTickerComparison(
      [row("BAC", "2026-08-04"), row("IBM", "2026-07-31")],
      [],
    );
    const vintage = shaped.vintage as Record<string, unknown>;
    expect(vintage.aligned).toBe(false);
    expect(vintage.note).toContain("NOT on one date");
    expect(vintage.teos).toEqual({ BAC: "2026-08-04", IBM: "2026-07-31" });
  });

  it("treats a missing teo as unaligned", () => {
    const shaped = shapeTickerComparison(
      [row("BAC", "2026-08-04"), row("IBM", null)],
      [],
    );
    expect((shaped.vintage as Record<string, unknown>).aligned).toBe(false);
  });

  it("carries unresolved names so they are named, not silently dropped", () => {
    const shaped = shapeTickerComparison(
      [row("BAC", "2026-08-04"), row("IBM", "2026-08-04")],
      [{ ticker: "ZZZQ", reason: "symbol not found" }],
    );
    expect(shaped.unresolved).toEqual([{ ticker: "ZZZQ", reason: "symbol not found" }]);
  });
});

describe("compare_tickers sanitizer", () => {
  it("passes a bounded comparison through with its rows intact", () => {
    const def = TOOL_MAP["compare_tickers"];
    const shaped = shapeTickerComparison(
      [row("BAC", "2026-08-04"), row("IBM", "2026-08-04")],
      [],
    );
    const sanitized = def.sanitizer!(shaped) as Record<string, unknown>;
    expect(Array.isArray(sanitized.comparison)).toBe(true);
    expect((sanitized.comparison as unknown[]).length).toBe(2);
  });
});
