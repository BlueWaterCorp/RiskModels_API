import { describe, expect, it } from "vitest";
import {
  annotatePortfolioRows,
  compareHoldingsRank,
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
  it("does not rewrite ids that are not CIK-shaped", () => {
    expect(normalizeFilerId("BW-SYNTH-ABC")).toBe("BW-SYNTH-ABC");
    expect(normalizeFilerId("BW-FILER-CRD123456")).toBe("BW-FILER-CRD123456");
    expect(normalizeFilerId("BW-FILER-123456")).toBe("BW-FILER-123456");
  });
  it("rejects empty, all-zero and undecodable input", () => {
    expect(normalizeFilerId("")).toBeNull();
    expect(normalizeFilerId(undefined)).toBeNull();
    expect(normalizeFilerId("CIK0")).toBeNull();
    expect(normalizeFilerId("0000000000")).toBeNull();
    expect(normalizeFilerId("%E0%A4%A")).toBeNull();
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

const EV = {
  // Q1: original A (complete) then amendment B (complete). Q2: original C complete, later D INCOMPLETE; the book
  // (ds_ph) is C. Q3: two filings on the same day E, F; the book is F.
  report_date: ["2026-03-31", "2026-03-31", "2026-06-30", "2026-06-30", "2026-09-30", "2026-09-30"],
  filing_date: ["2026-05-15", "2026-06-20", "2026-08-14", "2026-09-01", "2026-11-13", "2026-11-13"],
  accession_number: ["A", "B", "C", "D", "E", "F"],
  state_complete: [true, true, true, false, true, true],
  reported_aum_usd: [100, 200, 50, 70, 10, 20],
  mapped_aum_usd: [90, 150, 40, 7, 9, 10],
};
const BOOKS = new Map<string, string | null>([
  ["2026-03-31", "B"],
  ["2026-06-30", "C"],
  ["2026-09-30", "F"],
]);

describe("summarizeVintages keys book fields on the row's own book", () => {
  const v = summarizeVintages(EV, BOOKS)!;
  it("(4) amendment book: original date from the first filing, fields from the amendment", () => {
    const q = v.get("2026-03-31")!;
    expect(q.original_filing_date).toBe("2026-05-15");
    expect(q.accession_number).toBe("B");
    expect(q.book_filing_date).toBe("2026-06-20");
    expect(q.n_amendments).toBe(1);
    expect(q.mapped_aum_usd).toBe(150);
  });
  it("a later INCOMPLETE filing is not assumed to be the book", () => {
    const q = v.get("2026-06-30")!;
    expect(q.accession_number).toBe("C");
    expect(q.book_complete).toBe(true);
    expect(q.mapped_aum_usd).toBe(40);
  });
  it("same-day pair stored in reverse order: the book is the one ds_ph names", () => {
    const rev = {
      ...EV,
      report_date: [...EV.report_date.slice(0, 4), "2026-09-30", "2026-09-30"],
      accession_number: [...EV.accession_number.slice(0, 4), "F", "E"],
      reported_aum_usd: [...EV.reported_aum_usd.slice(0, 4), 20, 10],
      mapped_aum_usd: [...EV.mapped_aum_usd.slice(0, 4), 10, 9],
    };
    const q = summarizeVintages(rev, BOOKS)!.get("2026-09-30")!;
    expect(q.accession_number).toBe("F");
    expect(q.mapped_aum_usd).toBe(10);
  });
  it("a named book missing from the vintage store is flagged, its fields null", () => {
    const q = summarizeVintages(EV, new Map([["2026-06-30", "ZZZ"]]))!.get("2026-06-30")!;
    expect(q.book_missing).toBe(true);
    expect(q.accession_number).toBeNull();
    expect(q.mapped_aum_usd).toBeNull();
  });
  it("without a named book the book fields are null, never the latest filing", () => {
    const q = summarizeVintages(EV, new Map())!.get("2026-06-30")!;
    expect(q.accession_number).toBeNull();
    expect(q.book_complete).toBeNull();
    expect(q.book_missing).toBe(false);
    expect(q.original_filing_date).toBe("2026-08-14");
  });
  it("arrays of unequal length are rejected as malformed", () => {
    expect(summarizeVintages({ ...EV, filing_date: EV.filing_date.slice(1) }, BOOKS)).toBeNull();
  });
});

describe("round 3: missing books and same-day order", () => {
  it("a teo ds_ph names that the vintage store lacks entirely is a missing book, counted as a mismatch", () => {
    const v = summarizeVintages(EV, new Map([...BOOKS, ["2026-12-31", "G"]]))!;
    expect(v.get("2026-12-31")!.book_missing).toBe(true);
    const out = annotatePortfolioRows([row("2026-12-31", { filing_date: "2027-02-14" })], v, null, "2027-03-31");
    expect(out.book_mismatches).toBe(1);
    expect(out.rows[0]!.accession_number).toBeNull();
  });
  it.each([
    ["book-first", ["F", "E"]],
    ["book-second", ["E", "F"]],
  ])("same-day pair stored %s: amendment flag unknown, n_amendments 1", (_name, order) => {
    const ev = {
      ...EV,
      accession_number: [...EV.accession_number.slice(0, 4), ...order],
    };
    const v = summarizeVintages(ev, BOOKS)!;
    const q = v.get("2026-09-30")!;
    expect(q.n_amendments).toBe(1);
    expect(q.original_accession_number).toBeNull();
    const out = annotatePortfolioRows([row("2026-09-30", { filing_date: "2026-11-13" })], v, null, "2027-06-01");
    expect(out.rows[0]!.filing_date_is_amendment).toBeNull();
    expect(out.rows[0]!.accession_number).toBe("F");
  });
  it("ranking puts non-finite adj_mv last and still breaks ties by id", () => {
    const xs = [
      { security_id: "B", adj_mv: Number.NaN },
      { security_id: "A", adj_mv: 5 },
      { security_id: "C", adj_mv: 5 },
    ].sort(compareHoldingsRank);
    expect(xs.map((x) => x.security_id)).toEqual(["A", "C", "B"]);
  });
});

describe("annotatePortfolioRows", () => {
  const v = summarizeVintages(EV, BOOKS)!;
  it("publishes book fields only when the book's filing date equals the row's", () => {
    const ok = annotatePortfolioRows([row("2026-03-31", { filing_date: "2026-06-20" })], v, null, "2026-09-30");
    expect(ok.book_mismatches).toBe(0);
    expect(ok.rows[0]!.accession_number).toBe("B");
    expect(ok.rows[0]!.filing_date_is_amendment).toBe(true);
    expect(ok.rows[0]!.mapped_share).toBeCloseTo(0.75);
    const bad = annotatePortfolioRows([row("2026-03-31", { filing_date: "2026-05-15" })], v, null, "2026-09-30");
    expect(bad.book_mismatches).toBe(1);
    expect(bad.rows[0]!.accession_number).toBeNull();
    expect(bad.rows[0]!.mapped_share).toBeNull();
    expect(bad.rows[0]!.original_filing_date).toBe("2026-05-15");
  });
  it("same-day pair: which filing came first is not recorded, so the amendment flag is unknown", () => {
    const { rows } = annotatePortfolioRows([row("2026-09-30", { filing_date: "2026-11-13" })], v, null, "2027-06-01");
    expect(rows[0]!.filing_date_is_amendment).toBeNull();
  });
  it("(1) partial = the row's own window ends after the store's window_end; null when that was not read", () => {
    const { rows } = annotatePortfolioRows(
      [row("2026-03-31"), row("2026-06-30"), row("2026-09-30")],
      v,
      null,
      "2026-09-15",
    );
    expect(rows.map((r) => r.is_partial_period)).toEqual([false, true, true]);
    expect(annotatePortfolioRows([row("2026-06-30")], v, null, "2026-09-30").rows[0]!.is_partial_period).toBe(false);
    expect(annotatePortfolioRows([row("2026-09-30")], v, null, "2026-12-31").rows[0]!.is_partial_period).toBe(false);
    expect(annotatePortfolioRows([row("2026-06-30")], v, null, null).rows[0]!.is_partial_period).toBeNull();
  });
  it("(2) flags a stub row: returns with no holdings snapshot", () => {
    const { rows } = annotatePortfolioRows(
      [row("2026-06-30", { n_holdings_active: 0, filing_date: "2026-08-14" })],
      v,
      null,
      "2027-01-01",
    );
    expect(rows[0]!.is_stub).toBe(true);
    expect(rows[0]!.mapped_share).toBeCloseTo(0.8);
  });
  it("repair status: null without a ledger, 'none' when it lists nothing, else the entry with every kind", () => {
    expect(annotatePortfolioRows([row("2026-06-30")], v, null, "2027-01-01").rows[0]!.repair_status).toBeNull();
    const none = annotatePortfolioRows([row("2026-06-30")], v, new Map(), "2027-01-01").rows[0]!;
    expect(none.repair_status).toBe("none");
    expect(none.repair_rows_affected).toBe(0);
    const led = new Map([
      [
        "2026-06-30",
        {
          status: "rows_quarantined" as const,
          rows_affected: 2,
          detail: { units_repaired: 100, rows_quarantined: 2 },
        },
      ],
    ]);
    const r = annotatePortfolioRows([row("2026-06-30")], v, led, "2027-01-01").rows[0]!;
    expect(r.repair_status).toBe("rows_quarantined");
    expect(r.repair_rows_affected).toBe(2);
    expect(r.repair_detail).toEqual({ units_repaired: 100, rows_quarantined: 2 });
  });
  it("without a vintage store the vintage fields are null, never invented", () => {
    const r = annotatePortfolioRows([row("2026-06-30", { filing_date: "2026-08-14" })], null, null, null).rows[0]!;
    expect(r.original_filing_date).toBeNull();
    expect(r.filing_date_is_amendment).toBeNull();
    expect(r.n_amendments).toBeNull();
    expect(r.mapped_share).toBeNull();
  });
});

describe("(8) holdings ranking is stable across a tie at a page boundary", () => {
  it("orders ties by security_id, so offset 1000 is the same on every recompute", () => {
    const book = Array.from({ length: 1002 }, (_, i) => ({
      security_id: `BW-${String(i).padStart(5, "0")}`,
      adj_mv: i < 999 ? 10_000 - i : 5,
    })).reverse();
    const a = [...book].sort(compareHoldingsRank);
    const b = [...book].reverse().sort(compareHoldingsRank);
    expect(a.map((h) => h.security_id)).toEqual(b.map((h) => h.security_id));
    expect(a.slice(999, 1002).map((h) => h.security_id)).toEqual(["BW-00999", "BW-01000", "BW-01001"]);
  });
});
