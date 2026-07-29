import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMemoryRateLimits } from "@/lib/ratelimit/memory-fallback";

/**
 * The per-IP throttle on skipBilling routes (/api/funds/search,
 * /api/13f/filers/search) is the ONLY control on those unauthenticated
 * endpoints, and OPENAPI_SPEC.yaml publishes it as "60 requests/minute per IP".
 *
 * Upstash is unconfigured in tests, which is exactly the fail path that used to
 * skip the check entirely. These assert it now degrades to a per-instance
 * ceiling so the documented limit stays true.
 */

const ORIG_URL = process.env.UPSTASH_REDIS_REST_URL;

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  __resetMemoryRateLimits();
  vi.resetModules();
});

afterEach(() => {
  if (ORIG_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = ORIG_URL;
});

function req(ip: string): Request {
  return new Request("http://localhost/api/funds/search", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("skipBilling publicIpRateLimitPerMinute with Redis unavailable", () => {
  it("still refuses a caller past the limit instead of failing fully open", async () => {
    const { withBilling } = await import("@/lib/agent/billing-middleware");
    const handler = withBilling(
      async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
      { capabilityId: "fund-search", skipBilling: true, publicIpRateLimitPerMinute: 5 },
    );

    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await handler(req("3.3.3.3") as never)).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(statuses[6]).toBe(429);
  });

  it("keeps the degraded ceiling per-IP", async () => {
    const { withBilling } = await import("@/lib/agent/billing-middleware");
    const handler = withBilling(
      async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
      { capabilityId: "fund-search", skipBilling: true, publicIpRateLimitPerMinute: 2 },
    );

    for (let i = 0; i < 3; i++) await handler(req("4.4.4.4") as never);
    expect((await handler(req("4.4.4.4") as never)).status).toBe(429);
    // A different IP is unaffected.
    expect((await handler(req("5.5.5.5") as never)).status).toBe(200);
  });

  it("badge routes still answer 200 when throttled, for Shields.io", async () => {
    const { withBilling } = await import("@/lib/agent/billing-middleware");
    const handler = withBilling(
      async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
      {
        capabilityId: "rankings-badge",
        skipBilling: true,
        publicIpRateLimitPerMinute: 1,
        publicRateLimitResponse: "badge",
      },
    );

    await handler(req("6.6.6.6") as never);
    const throttled = await handler(req("6.6.6.6") as never);
    expect(throttled.status).toBe(200);
    expect(await throttled.json()).toMatchObject({ isError: true, message: "rate limited" });
  });
});
