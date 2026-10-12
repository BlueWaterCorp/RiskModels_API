/**
 * get_fundamentals chat-tool payload — the fields the copilot relies on to
 * answer cost-of-capital and provenance questions honestly (post-deploy
 * golden evals aapl-coc / nflx-coc / sec-provenance in
 * scripts/evals/copilot-eval.mjs): an `assumptions` block naming ERP, rf
 * tenor and tax rate as assumptions; percent-formatted cost of capital; and
 * SEC EDGAR provenance for sec_facts.
 *
 * Fixture: a real production AAPL row (tests/fixtures/fundamentals/).
 */

import { describe, expect, it } from "vitest";
import fixture from "./fixtures/fundamentals/aapl-row-2026-06-30.json";
import { sanitizeFundamentalsRow } from "@/lib/api/fundamentals-contract";
import {
  formatPct,
  shapeFundamentalsToolResult,
} from "@/lib/chat/tools";

const row = sanitizeFundamentalsRow(fixture.row as unknown as Record<string, unknown>);

function shape(erpSupplied = false) {
  return shapeFundamentalsToolResult({
    ticker: "AAPL",
    asOf: "2026-10-01",
    rows: [row],
    erp: 0.05,
    erpSupplied,
    taxRate: 0.21,
    rfTenor: "10y",
  });
}

describe("formatPct", () => {
  it("formats fractions as two-decimal percents and nulls non-finite", () => {
    expect(formatPct(0.10032113045454025)).toBe("10.03%");
    expect(formatPct(0.05)).toBe("5.00%");
    expect(formatPct(null)).toBeNull();
    expect(formatPct(Number.NaN)).toBeNull();
  });
});

describe("get_fundamentals tool payload", () => {
  it("labels ERP, rf tenor and tax rate as assumptions", () => {
    const out = shape();
    expect(out.assumptions.note).toMatch(/assumption/i);
    expect(out.assumptions.erp).toMatchObject({ value: 0.05, pct: "5.00%" });
    expect(out.assumptions.erp.basis).toMatch(/default assumption/);
    expect(out.assumptions.risk_free_rate).toMatchObject({ tenor: "10y", pct: "4.44%" });
    expect(out.assumptions.tax_rate).toMatchObject({ value: 0.21, pct: "21.00%" });
    expect(shape(true).assumptions.erp.basis).toMatch(/supplied with the request/);
  });

  it("carries percent-formatted latest cost of capital beside the fraction rows", () => {
    const out = shape();
    expect(out.latest_cost_of_capital).toMatchObject({
      period_end_date: "2026-06-30",
      cost_of_equity: "10.03%",
      cost_of_debt: null,
      cost_of_debt_imputed: "5.24%",
      wacc: null,
      wacc_imputed: "7.44%",
      rf_rate: "4.44%",
    });
    expect(out.latest_cost_of_capital?.cost_of_equity).toMatch(/\d\.\d{1,2}\s?%/);
    // Fractions in rows[] are unchanged.
    expect(out.rows[0]!.cost_of_equity).toBeCloseTo(0.10032113, 6);
  });

  it("states SEC EDGAR provenance for sec_facts", () => {
    const out = shape();
    expect(out.provenance.sec_facts).toMatch(/SEC EDGAR/);
    expect(out.usage_notes.sec_facts).toMatch(/SEC/);
    expect(Object.values(out.rows[0]!.sec_facts).every((f) => f?.source === "us_gaap")).toBe(
      true,
    );
  });

  it("tells the model to state assumptions when quoting cost of capital", () => {
    expect(shape().usage_notes.cost_of_capital).toMatch(/assumptions/i);
  });

  it("returns null latest summary when no rows are visible", () => {
    const out = shapeFundamentalsToolResult({
      ticker: "AAPL",
      asOf: "2000-01-01",
      rows: [],
      erp: 0.05,
      erpSupplied: false,
      taxRate: 0.21,
      rfTenor: "10y",
    });
    expect(out.latest_cost_of_capital).toBeNull();
    expect(out.assumptions.risk_free_rate.value).toBeNull();
  });
});
