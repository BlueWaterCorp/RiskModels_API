import { describe, expect, it } from "vitest";
import { nameOn, tickerOn, type NameRow } from "@/lib/identity/names";

const meta: NameRow[] = [
  { bw_sym_id: "M", kind: "issuer_legal", name: "Facebook Inc", valid_from: "2005-05-06", valid_to: "2021-10-28", source: "edgar" },
  { bw_sym_id: "M", kind: "issuer_legal", name: "Meta Platforms, Inc.", valid_from: "2021-10-28", valid_to: null, source: "edgar" },
  { bw_sym_id: "M", kind: "share_class", name: "Class A", valid_from: null, valid_to: null, source: "figi" },
];

describe("nameOn", () => {
  it("uses the legal name in force on the date, with the share class", () => {
    expect(nameOn(meta, "2015-06-01")?.name).toBe("Facebook Inc Class A");
    expect(nameOn(meta, "2021-10-27")?.name).toBe("Facebook Inc Class A");
    expect(nameOn(meta, "2021-10-28")?.name).toBe("Meta Platforms, Inc. Class A");
  });

  it("prefers the fund name for a fund", () => {
    const etf: NameRow[] = [{ bw_sym_id: "E", kind: "fund", name: "ProShares S&P 500 Dynamic Buffer ETF", valid_from: null, valid_to: null, source: "fm" }];
    expect(nameOn(etf, "2026-10-18")?.name).toBe("ProShares S&P 500 Dynamic Buffer ETF");
  });

  it("does not repeat a class the legal name already carries, and is null with no covering window", () => {
    const b: NameRow[] = [
      { bw_sym_id: "B", kind: "issuer_legal", name: "Example Corp Class B", valid_from: "2010-01-01", valid_to: null, source: "edgar" },
      { bw_sym_id: "B", kind: "share_class", name: "Class B", valid_from: null, valid_to: null, source: "figi" },
    ];
    expect(nameOn(b, "2020-01-01")?.name).toBe("Example Corp Class B");
    expect(nameOn(b, "2005-01-01")).toBeNull();
    expect(nameOn(undefined, "2020-01-01")).toBeNull();
  });
});

describe("tickerOn", () => {
  const reviewed = [
    { bw_sym_id: "M", ticker: "FB", start: null, end: "2022-06-09" },
    { bw_sym_id: "M", ticker: "META", start: "2022-06-09", end: null },
  ];
  it("uses the reviewed window covering the date", () => {
    expect(tickerOn(reviewed, [], "M", "2015-06-01")).toBe("FB");
    expect(tickerOn(reviewed, [], "M", "2022-06-09")).toBe("META");
  });
  it("falls back to a dated alias, ignores undated ones, and gives up on conflicts", () => {
    expect(tickerOn([], [{ bw_sym_id: "X", ticker: "OLD", start: "2001-01-01", end: "2010-01-01" }], "X", "2005-01-03")).toBe("OLD");
    expect(tickerOn([], [{ bw_sym_id: "X", ticker: "ANY", start: null, end: null }], "X", "2005-01-03")).toBeNull();
    expect(tickerOn([], [
      { bw_sym_id: "X", ticker: "A", start: "2001-01-01", end: null },
      { bw_sym_id: "X", ticker: "B", start: "2002-01-01", end: null },
    ], "X", "2005-01-03")).toBeNull();
  });
});
