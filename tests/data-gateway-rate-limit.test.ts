import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDataGatewayRateLimit,
  clientIp,
} from "@/lib/ratelimit/data-gateway-rate-limit";

/**
 * EODHD Exhibit B(g) anti-scraping throttle on the /api/data/* gateway.
 * These tests cover the pure logic (IP extraction, service-key exemption,
 * fail-open). The Upstash-backed counting path is exercised in integration.
 */

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIp(headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });
  it("returns 'unknown' when no IP headers are present", () => {
    expect(clientIp(headers({}))).toBe("unknown");
  });
});

describe("checkDataGatewayRateLimit", () => {
  const ORIG_KEY = process.env.RISKMODELS_API_SERVICE_KEY;
  const ORIG_URL = process.env.UPSTASH_REDIS_REST_URL;
  beforeEach(() => {
    process.env.RISKMODELS_API_SERVICE_KEY = "svc-secret";
    // Ensure Upstash is treated as unconfigured so we never hit the network.
    delete process.env.UPSTASH_REDIS_REST_URL;
  });
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.RISKMODELS_API_SERVICE_KEY;
    else process.env.RISKMODELS_API_SERVICE_KEY = ORIG_KEY;
    if (ORIG_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIG_URL;
  });

  it("exempts first-party service-key callers", async () => {
    const r = await checkDataGatewayRateLimit(headers({ authorization: "Bearer svc-secret" }));
    expect(r.ok).toBe(true);
  });

  it("fails open when Upstash is not configured", async () => {
    const r = await checkDataGatewayRateLimit(headers({ "x-forwarded-for": "1.2.3.4" }));
    expect(r.ok).toBe(true);
  });
});
