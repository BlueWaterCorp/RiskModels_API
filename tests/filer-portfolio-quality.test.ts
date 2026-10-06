import { describe, expect, it } from "vitest";
import {
  annotatePortfolioRows,
  missingQuarters,
  nextQuarterEnd,
  normalizeFilerId,
  summarizeVintages,
} from "@/lib/13f/filer-portfolio-quality";

// H.307 — defects found by @nijataliyev03 in the 13F attribution study (RiskModels_API PR #373).

describe("normalizeFilerId", () => {
  it.each([
    ["BW-FILER-CIK0001067983", "BW-FILER-CIK0001067983"],
    ["BW-FILER-CIK1067983", "BW-FILER-CIK0001067983"],
    ["CIK1067983", "BW-FILER-CIK0001067983"],
    ["cik0001067983", "BW-FILER-CIK0001067983"],
    ["0001067983", "BW-FILER-CIK0001067983"],
    ["1067983", "BW-FILER-CIK0001067983"],
    [" 1067983 ", "BW-FILER-CIK0001067983"],
  ])("%s -> %s", (raw, want) => {
    expect(normalizeFilerId(raw)).toBe(want);
  });
  it("leaves non-CIK ids and empties alone", () => {
    expect(normalizeFilerId("BW-SYNTH-ABC")).toBe("BW-SYNTH-ABC");
    expect(normalizeFilerId("BW-FILER-CRD123456")).toBe("BW-FILER-CRD123456");
    expect(normalizeFilerId("")).toBeNull();
    expect(normalizeFilerId(undefined)).toBeNull();
  });
});

describe("quarters", () => {
  it("steps quarter-ends across year boundaries and month lengths", () => {
    expect(nextQuarterEnd("2025-12-31")).toBe("2026-03-31");
    expect(nextQuarterEnd("2026-03-31")).toBe("2026-06-30");
    expect(nextQuarterEnd("2026-06-30")).toBe("2026-09-30");
  });
  it("lists gaps strictly inside the series (Berkshire-shaped)", () => {
    expect(missingQuarters(["2015-03-31", "2015-09-30", "2015-12-31", "2016-06-30"])).toEqual([
      "2015-06-30",
      "2016-03-31",
    ]);
    expect(missingQuarters(["2015-03-31"])).toEqual([]);
  });
});

const row = (teo: string, extra: Partial<Record<string, unknown>> = {}) => ({
  teo,
  filing_date: null as string | null,
  n_holdings_active: 10 as number | null,
  coverage_in_erm3: 0.9 as number | null,
  portfolio_gross_return: 0.01 as number | null,
  portfolio_market_return: 0.01 as number | null,
  portfolio_idiosyncratic_return: 0.0 as number | null,
  ...extra,
});

describe("annotatePortfolioRows", () => {
  const vintages = summarizeVintages({
    report_date: ["2026-03-31", "2026-03-31", "2026-06-30"],
    filing_date: ["2026-05-15", "2026-06-20", "2026-08-14"],
    accession_number: ["A-orig", "A-amend", "B"],
    state_complete: [true, true, false],
    reported_aum_usd: [100, 200, 50],
    mapped_aum_usd: [90, 150, null],
  });

  it("(4) reports the original filing date and flags an amendment-dated row", () => {
    const [r] = annotatePortfolioRows([row("2026-03-31", { filing_date: "2026-06-20" })], vintages, null, "2026-10-06");
    expect(r!.original_filing_date).toBe("2026-05-15");
    expect(r!.filing_date_is_amendment).toBe(true);
    expect(r!.n_amendments).toBe(1);
    expect(r!.accession_number).toBe("A-amend");
    expect(r!.mapped_share).toBeCloseTo(0.75);
    expect(r!.erm3_universe_share).toBe(0.9);
  });

  it("(1) flags only the last row as partial while its forward window is open", () => {
    const rows = annotatePortfolioRows([row("2026-03-31"), row("2026-06-30")], vintages, null, "2026-09-29");
    expect(rows.map((r) => r.is_partial_period)).toEqual([false, true]);
    const closed = annotatePortfolioRows([row("2026-06-30")], vintages, null, "2026-10-01");
    expect(closed[0]!.is_partial_period).toBe(false);
  });

  it("(2) flags a stub row: returns with no holdings snapshot", () => {
    const [r] = annotatePortfolioRows([row("2026-06-30", { n_holdings_active: 0 })], vintages, null, "2027-01-01");
    expect(r!.is_stub).toBe(true);
    expect(r!.book_complete).toBe(false);
    expect(r!.mapped_share).toBeNull();
  });

  it("repair status: null without a ledger, 'none' when the ledger lists nothing, else the ledger entry", () => {
    expect(annotatePortfolioRows([row("2026-06-30")], vintages, null, "2027-01-01")[0]!.repair_status).toBeNull();
    const empty = new Map();
    expect(annotatePortfolioRows([row("2026-06-30")], vintages, empty, "2027-01-01")[0]!.repair_status).toBe("none");
    const led = new Map([["2026-06-30", { status: "units_repaired" as const, rows_affected: 12 }]]);
    const [r] = annotatePortfolioRows([row("2026-06-30")], vintages, led, "2027-01-01");
    expect(r!.repair_status).toBe("units_repaired");
    expect(r!.repair_rows_affected).toBe(12);
  });

  it("without a vintage store the vintage fields are null, never invented", () => {
    const [r] = annotatePortfolioRows([row("2026-06-30", { filing_date: "2026-08-14" })], null, null, "2027-01-01");
    expect(r!.original_filing_date).toBeNull();
    expect(r!.filing_date_is_amendment).toBeNull();
    expect(r!.n_amendments).toBeNull();
    expect(r!.mapped_share).toBeNull();
  });
});
