import { describe, expect, it } from "vitest";
import { filterSafeMetadata } from "@/lib/dal/symbol-metadata";

describe("filterSafeMetadata", () => {
  it("strips licensed third-party identifiers from metadata", () => {
    const input = {
      isin: "US0378331005",
      cusip: "037833100",
      industry_code: "12345",
      figi: "BBG000B9XRY4",
      sector: "Technology",
      company_name: "Apple Inc.",
      market_etf: "SPY",
      sector_etf: "XLK",
      subsector_etfs: ["SOXX"],
      is_delisted: false,
      unique_ticker: "AAPL",
    };
    const out = filterSafeMetadata(input);
    expect(out).toEqual({
      figi: "BBG000B9XRY4",
      sector: "Technology",
      company_name: "Apple Inc.",
      market_etf: "SPY",
      sector_etf: "XLK",
      subsector_etfs: ["SOXX"],
      is_delisted: false,
      unique_ticker: "AAPL",
    });
    expect(out).not.toHaveProperty("isin");
    expect(out).not.toHaveProperty("cusip");
    expect(out).not.toHaveProperty("industry_code");
  });

  it("returns null for null/undefined input", () => {
    expect(filterSafeMetadata(null)).toBeNull();
    expect(filterSafeMetadata(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(filterSafeMetadata("string")).toBeNull();
    expect(filterSafeMetadata(123)).toBeNull();
    expect(filterSafeMetadata([1, 2, 3])).toBeNull();
  });

  it("returns empty object when input has no safe keys", () => {
    const input = { isin: "US123", cusip: "123", industry_code: "A1" };
    expect(filterSafeMetadata(input)).toEqual({});
  });

  it("ignores unknown keys not on safelist", () => {
    const input = {
      sector: "Tech",
      some_unknown_field: "leaks_through",
      another_random_key: 42,
    };
    expect(filterSafeMetadata(input)).toEqual({ sector: "Tech" });
  });
});
