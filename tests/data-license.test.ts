import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import {
  RAW_RESTRICTED_KEYS,
  RAW_SERIES_KEYS,
  RESTRICTED_SOURCE_SYMBOLS,
  dropRawSeriesKeys,
  getDataLicenseMode,
  isGatewayAuthenticated,
  isRestrictedSourceSymbol,
  rawEodhdPermitted,
  requestsRawRestricted,
  stripRawRestricted,
  stripRawRestrictedDeep,
  stripRawSeries,
} from "@/lib/data-license";

/**
 * Codifies the EODHD Exhibit B(e) policy enforced on /api/data/security-history.
 * If these expectations change, confirm against the signed agreement
 * (RiskModels_IP/docs/licensing/EODHD_Agreement_v3_Complete_DocuSign.pdf).
 */

function reqWithAuth(authHeader: string | null): NextRequest {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? authHeader : null) },
  } as unknown as NextRequest;
}

describe("EODHD data-license policy", () => {
  it("restricts exactly the two raw EODHD fields", () => {
    expect([...RAW_RESTRICTED_KEYS].sort()).toEqual(["market_cap", "price_close"]);
  });

  it("flags requests that include raw fields", () => {
    expect(requestsRawRestricted(["l1_mkt_hr", "price_close"])).toBe(true);
    expect(requestsRawRestricted(["market_cap"])).toBe(true);
    expect(requestsRawRestricted([" price_close "])).toBe(true); // tolerates whitespace
  });

  it("treats derived-only requests as unrestricted", () => {
    expect(requestsRawRestricted(["l1_mkt_hr", "returns_gross", "lstar_rr"])).toBe(false);
    expect(requestsRawRestricted([])).toBe(false);
  });

  it("strips raw fields but keeps derived columns", () => {
    const row = { symbol: "AAPL", price_close: 200, market_cap: 3e12, l1_mkt_hr: 0.9 };
    expect(stripRawRestricted(row)).toEqual({ symbol: "AAPL", l1_mkt_hr: 0.9 });
  });

  describe("stripRawRestrictedDeep (chat tool results)", () => {
    it("strips raw fields nested under an object", () => {
      const result = {
        ticker: "AAPL",
        teo: "2026-07-15",
        metrics: { vol_23d: 0.28, price_close: 200, market_cap: 3e12, l3_res_er: 0.4 },
      };
      expect(stripRawRestrictedDeep(result)).toEqual({
        ticker: "AAPL",
        teo: "2026-07-15",
        metrics: { vol_23d: 0.28, l3_res_er: 0.4 },
      });
    });

    it("strips raw fields across every row of a history series", () => {
      const result = {
        ticker: "AAPL",
        data: [
          { date: "2026-07-14", returns_gross: 0.01, price_close: 198 },
          { date: "2026-07-15", returns_gross: -0.02, price_close: 200 },
        ],
      };
      expect(stripRawRestrictedDeep(result)).toEqual({
        ticker: "AAPL",
        data: [
          { date: "2026-07-14", returns_gross: 0.01 },
          { date: "2026-07-15", returns_gross: -0.02 },
        ],
      });
    });

    it("keeps returns_gross — Derived Data under the EODHD terms", () => {
      expect(stripRawRestrictedDeep({ returns_gross: 0.01 })).toEqual({ returns_gross: 0.01 });
    });

    it("passes through primitives, null, and arrays of scalars", () => {
      expect(stripRawRestrictedDeep(null)).toBeNull();
      expect(stripRawRestrictedDeep("AAPL")).toBe("AAPL");
      expect(stripRawRestrictedDeep([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });

  describe("isGatewayAuthenticated", () => {
    const ORIG = process.env.RISKMODELS_API_SERVICE_KEY;
    beforeEach(() => {
      process.env.RISKMODELS_API_SERVICE_KEY = "svc-secret";
    });
    afterEach(() => {
      if (ORIG === undefined) delete process.env.RISKMODELS_API_SERVICE_KEY;
      else process.env.RISKMODELS_API_SERVICE_KEY = ORIG;
    });

    it("accepts the matching service key", () => {
      expect(isGatewayAuthenticated(reqWithAuth("Bearer svc-secret"))).toBe(true);
    });

    it("rejects missing or wrong bearer", () => {
      expect(isGatewayAuthenticated(reqWithAuth(null))).toBe(false);
      expect(isGatewayAuthenticated(reqWithAuth("Bearer rm_agent_live_xyz"))).toBe(false);
    });

    it("passes through when no service key is configured (dev)", () => {
      delete process.env.RISKMODELS_API_SERVICE_KEY;
      expect(isGatewayAuthenticated(reqWithAuth(null))).toBe(true);
    });
  });
});

describe("CRSP derived-only symbol gate (GATE 2)", () => {
  it("loads a non-empty generated denylist of BW ids", () => {
    expect(RESTRICTED_SOURCE_SYMBOLS.size).toBeGreaterThan(0);
    for (const s of RESTRICTED_SOURCE_SYMBOLS) expect(s).toMatch(/^BW-/);
  });

  it("matches known CRSP-seeded symbols and nothing else", () => {
    expect(isRestrictedSourceSymbol("BW-BR_OLD")).toBe(true);
    expect(isRestrictedSourceSymbol("BW-CFC_OLD")).toBe(true);
    expect(isRestrictedSourceSymbol("BW-BBG000B9XRY4")).toBe(false); // AAPL
    expect(isRestrictedSourceSymbol("BR_OLD")).toBe(false); // ticker, not bw id
  });

  it("raw-series set is a superset of the EODHD raw fields plus returns", () => {
    for (const k of RAW_RESTRICTED_KEYS) expect(RAW_SERIES_KEYS.has(k)).toBe(true);
    expect(RAW_SERIES_KEYS.has("returns_gross")).toBe(true);
  });

  it("drops raw-series keys, keeps derived", () => {
    expect(
      dropRawSeriesKeys(["returns_gross", "l1_cfr", "price_close", "l3_res_er"]),
    ).toEqual(["l1_cfr", "l3_res_er"]);
  });

  it("strips raw-series columns from wide rows, keeps derived", () => {
    const row = {
      symbol: "BW-BR_OLD",
      returns_gross: 0.01,
      price_close: 45.2,
      market_cap: 3.4e10,
      l1_mkt_hr: 0.8,
    };
    expect(stripRawSeries(row)).toEqual({ symbol: "BW-BR_OLD", l1_mkt_hr: 0.8 });
  });
});

describe("license_free mode (GATE 1 escalation)", () => {
  const ORIG_MODE = process.env.DATA_LICENSE_MODE;
  const ORIG_KEY = process.env.RISKMODELS_API_SERVICE_KEY;
  afterEach(() => {
    if (ORIG_MODE === undefined) delete process.env.DATA_LICENSE_MODE;
    else process.env.DATA_LICENSE_MODE = ORIG_MODE;
    if (ORIG_KEY === undefined) delete process.env.RISKMODELS_API_SERVICE_KEY;
    else process.env.RISKMODELS_API_SERVICE_KEY = ORIG_KEY;
  });

  it("defaults to standard mode", () => {
    delete process.env.DATA_LICENSE_MODE;
    expect(getDataLicenseMode()).toBe("standard");
  });

  it("standard mode: raw EODHD fields follow gateway auth", () => {
    delete process.env.DATA_LICENSE_MODE;
    process.env.RISKMODELS_API_SERVICE_KEY = "svc-secret";
    expect(rawEodhdPermitted(reqWithAuth("Bearer svc-secret"))).toBe(true);
    expect(rawEodhdPermitted(reqWithAuth(null))).toBe(false);
  });

  it("license_free mode: raw EODHD fields denied even to the service key", () => {
    process.env.DATA_LICENSE_MODE = "license_free";
    process.env.RISKMODELS_API_SERVICE_KEY = "svc-secret";
    expect(rawEodhdPermitted(reqWithAuth("Bearer svc-secret"))).toBe(false);
  });
});
