import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDataGatewayRateLimit,
  clientIp,
} from "@/lib/ratelimit/data-gateway-rate-limit";
import { __resetMemoryRateLimits } from "@/lib/ratelimit/memory-fallback";

/**
 * EODHD Exhibit B(g) anti-scraping throttle on the /api/data/* gateway.
 * These tests cover the pure logic (IP extraction, service-key exemption,
 * degraded mode). The Upstash-backed counting path is exercised in integration.
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
    __resetMemoryRateLimits();
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

  it("still serves normal traffic when Upstash is not configured", async () => {
    const r = await checkDataGatewayRateLimit(headers({ "x-forwarded-for": "1.2.3.4" }));
    expect(r.ok).toBe(true);
  });

  it("degrades to a per-instance ceiling instead of failing fully open", async () => {
    // With Upstash unconfigured the limiter must still bound a single caller.
    // DATA_GATEWAY_RPM defaults to 120, so request 121 from one IP is refused.
    const h = headers({ "x-forwarded-for": "7.7.7.7" });
    let lastOk = true;
    for (let i = 0; i < 121; i++) {
      lastOk = (await checkDataGatewayRateLimit(h)).ok;
    }
    expect(lastOk).toBe(false);
  });

  it("keeps the degraded ceiling per-IP", async () => {
    const a = headers({ "x-forwarded-for": "8.8.8.8" });
    for (let i = 0; i < 121; i++) await checkDataGatewayRateLimit(a);
    expect((await checkDataGatewayRateLimit(a)).ok).toBe(false);
    // A different IP is unaffected.
    const b = headers({ "x-forwarded-for": "8.8.4.4" });
    expect((await checkDataGatewayRateLimit(b)).ok).toBe(true);
  });

  it("exempts the service key even in degraded mode", async () => {
    const h = headers({ authorization: "Bearer svc-secret", "x-forwarded-for": "9.9.9.9" });
    for (let i = 0; i < 200; i++) {
      expect((await checkDataGatewayRateLimit(h)).ok).toBe(true);
    }
  });
});
