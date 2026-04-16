import { describe, expect, it } from "vitest";
import {
  DEFAULT_MACRO_FACTORS,
  expandMacroFactorDbKeysForQuery,
  MACRO_FACTOR_DB_KEYS,
  normalizeMacroFactorKeys,
} from "@/lib/risk/macro-factor-keys";

describe("MACRO_FACTOR_DB_KEYS", () => {
  it("covers every DEFAULT_MACRO_FACTORS key with the canonical name first", () => {
    for (const k of DEFAULT_MACRO_FACTORS) {
      expect(MACRO_FACTOR_DB_KEYS[k].length).toBeGreaterThan(0);
      expect(MACRO_FACTOR_DB_KEYS[k][0]).toBe(k);
    }
  });

  it("includes the ten expected canonical factors", () => {
    expect(new Set(DEFAULT_MACRO_FACTORS)).toEqual(
      new Set([
        "inflation",
        "term_spread",
        "short_rates",
        "credit",
        "oil",
        "gold",
        "usd",
        "volatility",
        "bitcoin",
        "vix_spot",
      ]),
    );
  });

  it("keeps legacy v1 names as fall-through aliases on renamed factors", () => {
    // usd was "dxy" in v1; term_spread was "ust10y2y"; vix_spot was "vix".
    // Historical rows written with those names must still resolve.
    expect(MACRO_FACTOR_DB_KEYS.usd).toContain("dxy");
    expect(MACRO_FACTOR_DB_KEYS.term_spread).toContain("ust10y2y");
    expect(MACRO_FACTOR_DB_KEYS.vix_spot).toContain("vix");
  });
});

describe("expandMacroFactorDbKeysForQuery", () => {
  it("dedupes and expands legacy keys", () => {
    const q = expandMacroFactorDbKeysForQuery([
      "usd",
      "vix_spot",
      "oil",
    ]);
    expect(q).toContain("usd");
    expect(q).toContain("dxy");
    expect(q).toContain("vix_spot");
    expect(q).toContain("vix");
    expect(q).toContain("oil");
    expect(new Set(q).size).toBe(q.length);
  });
});

describe("normalizeMacroFactorKeys", () => {
  it("maps legacy v1 aliases to modern canonical names", () => {
    const { keys, warnings } = normalizeMacroFactorKeys([
      "dxy",        // legacy → usd
      "vix",        // legacy → vix_spot
      "ust10y2y",   // legacy → term_spread
    ]);
    expect(keys).toEqual(["usd", "vix_spot", "term_spread"]);
    expect(warnings).toHaveLength(0);
  });

  it("recognises the new canonical keys (inflation, short_rates, credit, volatility) directly", () => {
    const { keys, warnings } = normalizeMacroFactorKeys([
      "inflation",
      "short_rates",
      "credit",
      "volatility",
    ]);
    expect(keys).toEqual(["inflation", "short_rates", "credit", "volatility"]);
    expect(warnings).toHaveLength(0);
  });

  it("distinguishes volatility (VXX futures) from vix_spot (FRED VIXCLS) — they are NOT aliases", () => {
    const { keys } = normalizeMacroFactorKeys(["volatility", "vix_spot"]);
    expect(keys).toEqual(["volatility", "vix_spot"]);
  });
});
