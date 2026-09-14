import { describe, expect, it } from "vitest";

import {
  ACTIVE_LOOKBACK_DAYS,
  activeFilterIsNoop,
  activeReportDateFloor,
  applyActiveFundFilter,
  buildFundListingContext,
  isFundActiveForListing,
  parseActiveFundQueryParams,
} from "@/lib/dal/fund-lifecycle";

const UNIVERSE_LATEST = "2026-06-30";
const CTX = buildFundListingContext(true, UNIVERSE_LATEST);
const FLOOR = activeReportDateFloor(UNIVERSE_LATEST);

describe("activeReportDateFloor", () => {
  it("subtracts 400 days", () => {
    expect(ACTIVE_LOOKBACK_DAYS).toBe(400);
    expect(FLOOR).toBe("2025-05-26");
  });
});

describe("isFundActiveForListing", () => {
  it("active fund with a recent report passes", () => {
    expect(
      isFundActiveForListing(
        { status: "active", latest_report_date: "2026-03-31" },
        CTX,
      ),
    ).toBe(true);
  });

  it("active fund exactly at the floor passes", () => {
    expect(
      isFundActiveForListing({ status: "active", latest_report_date: FLOOR }, CTX),
    ).toBe(true);
  });

  it("active fund with a stale report fails", () => {
    expect(
      isFundActiveForListing(
        { status: "active", latest_report_date: "2025-03-31" },
        CTX,
      ),
    ).toBe(false);
  });

  it("delisted fund fails even with a recent report", () => {
    expect(
      isFundActiveForListing(
        { status: "delisted", latest_report_date: "2026-03-31" },
        CTX,
      ),
    ).toBe(false);
  });

  it("NULL status is unknown, not active, once an active universe exists", () => {
    expect(
      isFundActiveForListing({ status: null, latest_report_date: "2026-03-31" }, CTX),
    ).toBe(false);
  });

  it("falls back to no filter when lifecycle columns are absent", () => {
    const ctx = buildFundListingContext(false, null);
    expect(ctx.filterEnabled).toBe(false);
    expect(
      isFundActiveForListing({ latest_report_date: "2010-01-31" }, ctx),
    ).toBe(true);
  });

  it("falls back to no filter when columns exist but every status is NULL", () => {
    const ctx = buildFundListingContext(true, null);
    expect(ctx.filterEnabled).toBe(false);
    expect(
      isFundActiveForListing({ status: null, latest_report_date: "2010-01-31" }, ctx),
    ).toBe(true);
  });

  it("includeInactive keeps delisted and stale funds", () => {
    expect(
      isFundActiveForListing(
        { status: "delisted", latest_report_date: "2012-01-31" },
        CTX,
        { includeInactive: true },
      ),
    ).toBe(true);
  });

  it("includeEtfs=false drops ETFs and keeps non-ETF and unclassified funds", () => {
    const base = { status: "active", latest_report_date: "2026-03-31" };
    expect(
      isFundActiveForListing({ ...base, is_etf: true }, CTX, { includeEtfs: false }),
    ).toBe(false);
    expect(
      isFundActiveForListing({ ...base, is_etf: false }, CTX, { includeEtfs: false }),
    ).toBe(true);
    expect(
      isFundActiveForListing({ ...base, is_etf: null }, CTX, { includeEtfs: false }),
    ).toBe(true);
    expect(isFundActiveForListing({ ...base, is_etf: true }, CTX)).toBe(true);
  });
});

type Call = [string, ...unknown[]];

function recorder() {
  const calls: Call[] = [];
  const q = {
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), q),
    not: (...a: unknown[]) => (calls.push(["not", ...a]), q),
  };
  return { q, calls };
}

describe("applyActiveFundFilter", () => {
  it("adds status + report-date floor by default", () => {
    const { q, calls } = recorder();
    applyActiveFundFilter(q, CTX);
    expect(calls).toEqual([
      ["eq", "status", "active"],
      ["gte", "latest_report_date", FLOOR],
    ]);
  });

  it("adds is_etf exclusion when includeEtfs=false", () => {
    const { q, calls } = recorder();
    applyActiveFundFilter(q, CTX, { includeEtfs: false });
    expect(calls[0]).toEqual(["not", "is_etf", "is", true]);
  });

  it("adds nothing when includeInactive=true", () => {
    const { q, calls } = recorder();
    applyActiveFundFilter(q, CTX, { includeInactive: true });
    expect(calls).toEqual([]);
    expect(activeFilterIsNoop(CTX, { includeInactive: true })).toBe(true);
  });

  it("adds nothing when lifecycle columns are absent, even with includeEtfs=false", () => {
    const ctx = buildFundListingContext(false, null);
    const { q, calls } = recorder();
    applyActiveFundFilter(q, ctx, { includeEtfs: false });
    expect(calls).toEqual([]);
    expect(activeFilterIsNoop(ctx, { includeEtfs: false })).toBe(true);
  });
});

describe("parseActiveFundQueryParams", () => {
  it("defaults to includeInactive=false, includeEtfs=true", () => {
    expect(parseActiveFundQueryParams(new URLSearchParams())).toEqual({
      includeInactive: false,
      includeEtfs: true,
    });
  });

  it("parses explicit values", () => {
    expect(
      parseActiveFundQueryParams(
        new URLSearchParams("include_inactive=true&include_etfs=false"),
      ),
    ).toEqual({ includeInactive: true, includeEtfs: false });
    expect(
      parseActiveFundQueryParams(
        new URLSearchParams("include_inactive=0&include_etfs=1"),
      ),
    ).toEqual({ includeInactive: false, includeEtfs: true });
  });
});
