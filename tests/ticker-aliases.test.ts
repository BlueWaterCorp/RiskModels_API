import { describe, expect, it } from "vitest";
import {
  resolveTicker,
  resolveTickerAlias,
  resolveTickerAliases,
} from "@/lib/ticker-aliases";

/**
 * G.35: notation rewrites and share-class projections are different relations.
 * Reporting a notation rewrite would be noise; failing to report a projection
 * is what let `/stocks/GOOGL` render GOOG's decomposition undisclosed.
 */
describe("resolveTicker", () => {
  it("passes an ordinary ticker through unchanged and unprojected", () => {
    expect(resolveTicker("AAPL")).toEqual({
      requested: "AAPL",
      canonical: "AAPL",
      projected: false,
      requestedClass: null,
      modelledClass: null,
    });
  });

  it("uppercases and trims before resolving", () => {
    expect(resolveTicker("  googl ")).toMatchObject({
      requested: "GOOGL",
      canonical: "GOOG",
      projected: true,
    });
  });

  it("returns an empty resolution for empty input rather than throwing", () => {
    expect(resolveTicker("")).toMatchObject({ requested: "", canonical: "" });
  });

  describe("notation aliases — same security, no disclosure", () => {
    it.each([
      ["BRK.B", "BRK-B"],
      ["BRKB", "BRK-B"],
    ])("%s normalizes to %s without projecting", (input, expected) => {
      const r = resolveTicker(input);
      expect(r.canonical).toBe(expected);
      expect(r.projected).toBe(false);
      expect(r.requestedClass).toBeNull();
    });
  });

  describe("class projections — different security, must be disclosed", () => {
    it("projects Alphabet Class A onto Class C", () => {
      expect(resolveTicker("GOOGL")).toEqual({
        requested: "GOOGL",
        canonical: "GOOG",
        projected: true,
        requestedClass: "A",
        modelledClass: "C",
      });
    });

    it("projects Berkshire Class A onto Class B", () => {
      expect(resolveTicker("BRK-A")).toEqual({
        requested: "BRK-A",
        canonical: "BRK-B",
        projected: true,
        requestedClass: "A",
        modelledClass: "B",
      });
    });

    it("does not project the modelled class onto itself", () => {
      for (const t of ["GOOG", "BRK-B"]) {
        expect(resolveTicker(t)).toMatchObject({
          canonical: t,
          projected: false,
        });
      }
    });
  });

  /**
   * ERM3's map sent BRKA straight to BRK-B, collapsing both relations into one
   * hop. Split, BRKA is Class A notation that then projects — so the caller can
   * be told it is looking at Class B.
   */
  it("normalizes notation first, then projects, reporting only the projection", () => {
    expect(resolveTicker("BRKA")).toEqual({
      requested: "BRKA",
      canonical: "BRK-B",
      projected: true,
      requestedClass: "A",
      modelledClass: "B",
    });
  });
});

describe("resolveTickerAlias", () => {
  it("yields the canonical ticker for callers that do not disclose", () => {
    expect(resolveTickerAlias("GOOGL")).toBe("GOOG");
    expect(resolveTickerAlias("BRK.B")).toBe("BRK-B");
    expect(resolveTickerAlias("AAPL")).toBe("AAPL");
  });

  it("maps arrays elementwise", () => {
    expect(resolveTickerAliases(["GOOGL", "AAPL", "BRK-A"])).toEqual([
      "GOOG",
      "AAPL",
      "BRK-B",
    ]);
  });
});
