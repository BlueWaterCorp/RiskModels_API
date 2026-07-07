import { describe, expect, it } from "vitest";
import {
  FUNDAMENTALS_HELD_BACK_FIELDS,
  FUNDAMENTALS_ROW_ALLOWED_FIELDS,
  sanitizeFundamentalsRow,
} from "@/lib/api/fundamentals-contract";

/**
 * LICENSING GATE TESTS — these are the enforcement mechanism for the EODHD
 * Exhibit-B posture: raw vendor line items must never appear in a response
 * row. If a raw field is ever added to the allowlist (or leaks through
 * sanitize), this file fails.
 */
describe("fundamentals response allowlist", () => {
  it("held-back raw fields are disjoint from the allowlist", () => {
    const allowed = new Set<string>(FUNDAMENTALS_ROW_ALLOWED_FIELDS);
    for (const field of FUNDAMENTALS_HELD_BACK_FIELDS) {
      expect(allowed.has(field), `raw field "${field}" must not be allowlisted`).toBe(false);
    }
  });

  it("every raw vendor line item from the store is on the held-back list", () => {
    // The 13 stored line items — raw levels ship only if promoted to
    // SEC-sourced or cleared by counsel.
    const rawStorePlanes = [
      "revenue",
      "net_income",
      "ebitda",
      "eps_actual",
      "eps_estimate",
      "eps_diluted",
      "total_assets",
      "total_equity",
      "total_debt",
      "shares_outstanding_q",
      "cash_from_operations",
      "capital_expenditures",
      "interest_expense",
    ];
    const heldBack = new Set<string>(FUNDAMENTALS_HELD_BACK_FIELDS);
    for (const plane of rawStorePlanes) {
      expect(heldBack.has(plane), `store plane "${plane}" must be held back`).toBe(true);
    }
  });

  it("gray-pending-counsel and analyst/forecast fields are held back (asserted even though absent from the store)", () => {
    const heldBack = new Set<string>(FUNDAMENTALS_HELD_BACK_FIELDS);
    for (const f of [
      "earnings_surprise",
      "book_value_per_share",
      "eps_forecast",
      "revenue_forecast",
      "analyst_rating",
      "target_price",
    ]) {
      expect(heldBack.has(f), `"${f}" must be held back`).toBe(true);
    }
  });

  it("sanitizeFundamentalsRow strips every held-back field even when present on the input", () => {
    // Simulate a future refactor accidentally attaching raw planes to the row.
    const dirty: Record<string, unknown> = {
      period_end_date: "2025-12-31",
      filed_date: "2026-01-30",
      filed_date_source: "exact",
      roe_ttm: 1.6,
      cost_of_equity: 0.093,
    };
    for (const f of FUNDAMENTALS_HELD_BACK_FIELDS) {
      dirty[f] = 123456789;
    }
    const clean = sanitizeFundamentalsRow(dirty) as unknown as Record<string, unknown>;
    for (const f of FUNDAMENTALS_HELD_BACK_FIELDS) {
      expect(f in clean, `held-back field "${f}" leaked through sanitize`).toBe(false);
    }
    // And nothing outside the allowlist survives at all.
    const allowed = new Set<string>(FUNDAMENTALS_ROW_ALLOWED_FIELDS);
    for (const key of Object.keys(clean)) {
      expect(allowed.has(key), `unexpected key "${key}" in sanitized row`).toBe(true);
    }
    expect(clean.roe_ttm).toBe(1.6);
    expect(clean.period_end_date).toBe("2025-12-31");
  });

  it("sanitize null-fills missing allowlisted keys and maps non-finite numbers to null", () => {
    const clean = sanitizeFundamentalsRow({
      period_end_date: "2025-12-31",
      wacc: NaN,
      cost_of_debt: Infinity,
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(clean).sort()).toEqual([...FUNDAMENTALS_ROW_ALLOWED_FIELDS].sort());
    expect(clean.wacc).toBeNull();
    expect(clean.cost_of_debt).toBeNull();
    expect(clean.filed_date).toBeNull();
    expect(clean.roe_ttm).toBeNull();
  });
});
