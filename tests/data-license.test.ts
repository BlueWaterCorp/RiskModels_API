import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import {
  RAW_RESTRICTED_KEYS,
  isGatewayAuthenticated,
  requestsRawRestricted,
  stripRawRestricted,
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
