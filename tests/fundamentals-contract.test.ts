import { describe, expect, it } from "vitest";
import {
  FUNDAMENTALS_HELD_BACK_FIELDS,
  FUNDAMENTALS_ROW_ALLOWED_FIELDS,
  SEC_FACT_CONCEPTS,
  SEC_FACT_DENY,
  sanitizeFundamentalsRow,
  sanitizeSecFacts,
  secCellValue,
} from "@/lib/api/fundamentals-contract";

/**
 * LICENSING GATE TESTS — the enforcement mechanism for the EODHD Exhibit-B posture.
 *
 * Since 2026-07-10 raw line items may ship, but ONLY inside `sec_facts` and ONLY for cells whose
 * serving value is SEC XBRL (public). Two invariants this file guards:
 *  1. no raw vendor line item appears as a FLAT key on a response row;
 *  2. `sec_facts` only ever contains SEC-basis (us_gaap/ifrs), non-denied, finite values.
 */
describe("fundamentals response allowlist", () => {
  it("held-back raw fields are disjoint from the allowlist", () => {
    const allowed = new Set<string>(FUNDAMENTALS_ROW_ALLOWED_FIELDS);
    for (const field of FUNDAMENTALS_HELD_BACK_FIELDS) {
      expect(allowed.has(field), `raw field "${field}" must not be allowlisted`).toBe(false);
    }
  });

  it("SEC-fact concepts are NOT flat-allowlisted — they ship only nested in sec_facts", () => {
    const allowed = new Set<string>(FUNDAMENTALS_ROW_ALLOWED_FIELDS);
    for (const c of SEC_FACT_CONCEPTS) {
      expect(allowed.has(c), `concept "${c}" must never be a flat allowlist key`).toBe(false);
    }
    expect(allowed.has("sec_facts")).toBe(true);
  });

  it("EODHD-only and house-rule fields remain hard-held-back as flat keys", () => {
    const heldBack = new Set<string>(FUNDAMENTALS_HELD_BACK_FIELDS);
    for (const f of [
      // EODHD-only, no clean SEC raw exposure
      "ebitda", "eps_actual", "total_debt", "shares_outstanding_q",
      // no-investment-advice house rule
      "eps_estimate", "eps_forecast", "revenue_forecast", "analyst_rating", "target_price",
      // gray pending counsel
      "earnings_surprise", "book_value_per_share",
    ]) {
      expect(heldBack.has(f), `"${f}" must be held back`).toBe(true);
    }
  });

  it("house-rule fields are in SEC_FACT_DENY so they cannot enter sec_facts either", () => {
    for (const f of ["eps_estimate", "eps_forecast", "revenue_forecast", "analyst_rating", "target_price"]) {
      expect(SEC_FACT_DENY.has(f), `"${f}" must be denied inside sec_facts`).toBe(true);
    }
  });

  it("sanitizeFundamentalsRow strips held-back and stray flat SEC-concept keys", () => {
    const dirty: Record<string, unknown> = {
      period_end_date: "2025-12-31",
      filed_date: "2026-01-30",
      filed_date_source: "exact",
      roe_ttm: 1.6,
      cost_of_equity: 0.093,
    };
    for (const f of FUNDAMENTALS_HELD_BACK_FIELDS) dirty[f] = 123456789;
    // a future refactor accidentally attaching a raw flat plane:
    for (const c of SEC_FACT_CONCEPTS) dirty[c] = 999;
    const clean = sanitizeFundamentalsRow(dirty) as unknown as Record<string, unknown>;
    const allowed = new Set<string>(FUNDAMENTALS_ROW_ALLOWED_FIELDS);
    for (const key of Object.keys(clean)) {
      expect(allowed.has(key), `unexpected key "${key}" survived sanitize`).toBe(true);
    }
    for (const f of FUNDAMENTALS_HELD_BACK_FIELDS) expect(f in clean).toBe(false);
    for (const c of SEC_FACT_CONCEPTS) expect(c in clean).toBe(false); // no flat raw plane
    expect(clean.roe_ttm).toBe(1.6);
  });

  it("sanitize null-fills allowlisted keys; sec_facts defaults to {}", () => {
    const clean = sanitizeFundamentalsRow({
      period_end_date: "2025-12-31",
      wacc: NaN,
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(clean).sort()).toEqual([...FUNDAMENTALS_ROW_ALLOWED_FIELDS].sort());
    expect(clean.wacc).toBeNull();
    expect(clean.sec_facts).toEqual({});
  });
});

describe("secCellValue — the per-cell licensing gate", () => {
  it("passes a finite value only for SEC source planes (2=us_gaap, 3=ifrs)", () => {
    expect(secCellValue("revenue", 100, 2)).toEqual({ value: 100, source: "us_gaap" });
    expect(secCellValue("revenue", 100, 3)).toEqual({ value: 100, source: "ifrs" });
  });

  it("blocks EODHD (1), none (0) and null source — not redistributable", () => {
    expect(secCellValue("revenue", 100, 1)).toBeUndefined();
    expect(secCellValue("revenue", 100, 0)).toBeUndefined();
    expect(secCellValue("revenue", 100, null)).toBeUndefined();
  });

  it("blocks non-finite values and denied concepts", () => {
    expect(secCellValue("revenue", NaN, 2)).toBeUndefined();
    expect(secCellValue("revenue", null, 2)).toBeUndefined();
    expect(secCellValue("eps_estimate", 5, 2)).toBeUndefined(); // denied even with SEC source
  });
});

describe("sanitizeSecFacts — belt to the DAL suspenders", () => {
  it("keeps only allowed concepts with a SEC basis and finite value", () => {
    const clean = sanitizeSecFacts({
      revenue: { value: 100, source: "us_gaap" },
      total_equity: { value: 50, source: "ifrs" },
      net_income: { value: 10, source: "eodhd" }, // wrong basis → dropped
      capital_expenditures: { value: NaN, source: "us_gaap" }, // non-finite → dropped
      eps_estimate: { value: 5, source: "us_gaap" }, // denied → dropped
      not_a_concept: { value: 1, source: "us_gaap" }, // unknown → dropped
    });
    expect(clean).toEqual({
      revenue: { value: 100, source: "us_gaap" },
      total_equity: { value: 50, source: "ifrs" },
    });
  });

  it("never lets a non-SEC basis survive (the licensing invariant)", () => {
    const clean = sanitizeSecFacts({ revenue: { value: 1, source: "eodhd" } });
    expect(clean).toEqual({});
  });
});

import { decodeEquityBridgeInputs, EQUITY_BRIDGE_COMPONENTS } from "@/lib/api/fundamentals-contract";

describe("equity-bridge inputs decode (Phase 3)", () => {
  it("bit order matches the store (net_income..share_based_comp)", () => {
    expect(EQUITY_BRIDGE_COMPONENTS).toEqual([
      "net_income", "accumulated_oci", "dividends_declared", "dividends_preferred",
      "share_repurchases", "share_issuance", "share_based_comp",
    ]);
  });
  it("decodes a mask to the present components; a missing bit means unattributed", () => {
    // 83 = 1 + 2 + 16 + 64 (Apple's real mask): NI + OCI + buybacks + SBC, NO dividends
    expect(decodeEquityBridgeInputs(83)).toEqual([
      "net_income", "accumulated_oci", "share_repurchases", "share_based_comp",
    ]);
    expect(decodeEquityBridgeInputs(83)).not.toContain("dividends_declared");
  });
  it("null/NaN/0 → empty list", () => {
    expect(decodeEquityBridgeInputs(null)).toEqual([]);
    expect(decodeEquityBridgeInputs(NaN)).toEqual([]);
    expect(decodeEquityBridgeInputs(0)).toEqual([]);
  });
});

describe("fundamentals Kd honesty disclosures", () => {
  it("documents AAPL-class null policy and bank deposit-interest caveat", async () => {
    const { buildFundamentalsDisclosures } = await import("@/lib/api/fundamentals-contract");
    const d = buildFundamentalsDisclosures({
      erp: 0.05,
      tax_rate: 0.21,
      as_of: "2026-07-18",
      rf_tenor: "10y",
    });
    expect(String(d.cost_of_debt_null_policy)).toMatch(/Other income|null Kd as 0%/i);
    expect(String(d.cost_of_debt_bank_caveat)).toMatch(/deposit/i);
  });
});
