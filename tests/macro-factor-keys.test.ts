import { describe, expect, it } from "vitest";
import {
  DEFAULT_MACRO_FACTORS,
  expandMacroFactorDbKeysForQuery,
  MACRO_FACTOR_DB_KEYS,
  normalizeMacroFactorKeys,
} from "@/lib/risk/macro-factor-keys";

describe("MACRO_FACTOR_DB_KEYS", () => {
  it("covers every DEFAULT_MACRO_FACTORS key", () => {
    for (const k of DEFAULT_MACRO_FACTORS) {
      expect(MACRO_FACTOR_DB_KEYS[k].length).toBeGreaterThan(0);
      expect(MACRO_FACTOR_DB_KEYS[k][0]).toBe(k);
    }
  });

  it("includes legacy ERM3 aliases after canonical", () => {
    expect(MACRO_FACTOR_DB_KEYS.vix).toEqual(["vix", "vix_spot"]);
    expect(MACRO_FACTOR_DB_KEYS.dxy).toEqual(["dxy", "usd"]);
    expect(MACRO_FACTOR_DB_KEYS.ust10y2y).toEqual(["ust10y2y", "term_spread"]);
  });
});

describe("expandMacroFactorDbKeysForQuery", () => {
  it("dedupes and expands legacy keys", () => {
    const q = expandMacroFactorDbKeysForQuery(["vix", "dxy", "oil"]);
    expect(q).toContain("vix");
    expect(q).toContain("vix_spot");
    expect(q).toContain("dxy");
    expect(q).toContain("usd");
    expect(q).toContain("oil");
    expect(new Set(q).size).toBe(q.length);
  });
});

describe("normalizeMacroFactorKeys", () => {
  it("maps usd alias to dxy", () => {
    const { keys, warnings } = normalizeMacroFactorKeys(["usd", "vix"]);
    expect(keys).toEqual(["dxy", "vix"]);
    expect(warnings).toHaveLength(0);
  });
});
