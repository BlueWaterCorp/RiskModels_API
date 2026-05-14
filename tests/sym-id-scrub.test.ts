/**
 * lib/dal/sym-id-scrub — ISIN-leak scrub regex + substitution policy.
 *
 * MASTER_BACKLOG H.24 — `bw_sym_id` namespace is mixed (FIGI for most,
 * ISIN for a tail like SPY → `BW-US78462F1030`). The scrub rewrites the
 * ISIN-flavored ids at the public-API read boundary so licensed ANNA/NSA
 * identifiers don't leak. FIGI-flavored ids pass through unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  BW_FIGI_RE,
  BW_ISIN_RE,
  isFigiFlavoredSymId,
  isIsinFlavoredSymId,
  scrubBwSymId,
} from "@/lib/dal/sym-id-scrub";

describe("FIGI / ISIN shape detectors", () => {
  it("recognizes the FIGI form", () => {
    // Bloomberg FIGI: BW-BBG + 9 base-36 chars
    expect(isFigiFlavoredSymId("BW-BBG000B9XRY4")).toBe(true);  // AAPL
    expect(isFigiFlavoredSymId("BW-BBG000MM2P62")).toBe(true);  // META
    expect(isFigiFlavoredSymId("BW-BBG009S3NB30")).toBe(true);  // GOOG
    expect(isFigiFlavoredSymId("BW-BBG000BBJQV0")).toBe(true);  // NVDA
    expect(BW_FIGI_RE.test("BW-BBG000B9XRY4")).toBe(true);
  });

  it("recognizes the ISIN form (NOT classified as FIGI)", () => {
    // US ISIN: BW + US + 9-char NSIN + check digit
    expect(isIsinFlavoredSymId("BW-US78462F1030")).toBe(true);  // SPY
    expect(isFigiFlavoredSymId("BW-US78462F1030")).toBe(false);
    expect(BW_ISIN_RE.test("BW-US78462F1030")).toBe(true);
  });

  it("treats FIGI as NOT-ISIN even though FIGI shape technically matches ISIN regex", () => {
    // BW-BBG... has 2 letters ("BB") then 9 chars then digit — that would
    // ALSO match the ISIN regex, but the FIGI check takes precedence.
    expect(isIsinFlavoredSymId("BW-BBG000B9XRY4")).toBe(false);
  });

  it("passes through unknown / registry id forms", () => {
    // None of these should classify as ISIN — they're public registry ids.
    expect(isIsinFlavoredSymId("BW-FUND-S000004563")).toBe(false);
    expect(isIsinFlavoredSymId("BW-FILER-CIK0001067983")).toBe(false);
    expect(isIsinFlavoredSymId("BW-ETF-IVV")).toBe(false);
    expect(isIsinFlavoredSymId("BW-BENCH-SPY")).toBe(false);
    expect(isIsinFlavoredSymId("")).toBe(false);
    expect(isIsinFlavoredSymId(null)).toBe(false);
    expect(isIsinFlavoredSymId(undefined)).toBe(false);
  });
});

describe("scrubBwSymId policy", () => {
  it("passes through FIGI-flavored ids unchanged", () => {
    expect(scrubBwSymId("BW-BBG000B9XRY4")).toBe("BW-BBG000B9XRY4");
    expect(scrubBwSymId("BW-BBG000B9XRY4", { figi: "BBG000IGNORED" })).toBe(
      "BW-BBG000B9XRY4",
    );
  });

  it("passes through non-ISIN registry ids unchanged", () => {
    expect(scrubBwSymId("BW-FUND-S000004563")).toBe("BW-FUND-S000004563");
    expect(scrubBwSymId("BW-FILER-CIK0001067983")).toBe("BW-FILER-CIK0001067983");
    expect(scrubBwSymId("BW-ETF-IVV")).toBe("BW-ETF-IVV");
    expect(scrubBwSymId("BW-BENCH-SPY")).toBe("BW-BENCH-SPY");
  });

  it("substitutes FIGI when available for ISIN-flavored ids", () => {
    expect(
      scrubBwSymId("BW-US78462F1030", { figi: "BBG000000001" }),
    ).toBe("BW-BBG000000001");
    // FIGI input already prefixed with BBG should not double-prefix
    expect(
      scrubBwSymId("BW-US78462F1030", { figi: "BBG999999999" }),
    ).toBe("BW-BBG999999999");
  });

  it("falls back to BW-TICKER form when FIGI is missing but ticker is available", () => {
    expect(
      scrubBwSymId("BW-US78462F1030", { ticker: "SPY" }),
    ).toBe("BW-TICKER-SPY");
    // Ticker chars outside [A-Z0-9] are replaced (e.g., BRK.B → BRK_B).
    expect(
      scrubBwSymId("BW-US12345B1010", { ticker: "BRK.B" }),
    ).toBe("BW-TICKER-BRK_B");
    expect(
      scrubBwSymId("BW-US12345C1020", { ticker: "RDS-A" }),
    ).toBe("BW-TICKER-RDS_A");
  });

  it("FIGI takes precedence over ticker when both are present", () => {
    expect(
      scrubBwSymId("BW-US78462F1030", {
        figi: "BBG000000001",
        ticker: "SPY",
      }),
    ).toBe("BW-BBG000000001");
  });

  it("falls back to BW-RESTRICTED when neither FIGI nor ticker is available", () => {
    expect(scrubBwSymId("BW-US78462F1030")).toBe("BW-RESTRICTED");
    expect(scrubBwSymId("BW-US78462F1030", {})).toBe("BW-RESTRICTED");
    expect(scrubBwSymId("BW-US78462F1030", { figi: "", ticker: "" })).toBe(
      "BW-RESTRICTED",
    );
    expect(scrubBwSymId("BW-US78462F1030", { figi: null, ticker: null })).toBe(
      "BW-RESTRICTED",
    );
  });

  it("ignores whitespace-only FIGI / ticker values", () => {
    expect(
      scrubBwSymId("BW-US78462F1030", { figi: "   ", ticker: "  " }),
    ).toBe("BW-RESTRICTED");
  });
});
