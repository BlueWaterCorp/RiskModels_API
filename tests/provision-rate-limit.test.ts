import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVISION_DEGRADED_PER_HOUR,
  PROVISION_PER_IP_PER_DAY,
  PROVISION_UNKNOWN_IP_PER_DAY,
  __resetProvisionRateLimitBackend,
  checkClaimEmailAllowance,
  checkProvisionRateLimit,
  provisionClientIp,
  recentProvisionsFromIp,
  type CounterBackend,
} from "@/lib/agent/provision-rate-limit";
import { __resetMemoryRateLimits } from "@/lib/ratelimit/memory-fallback";
import { createFakeDb } from "./fixtures/fake-supabase";

/** Working counter with the three calls the limiter uses. */
function memoryBackend(): CounterBackend & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    async incr(key) {
      const n = (keys.get(key) ?? 0) + 1;
      keys.set(key, n);
      return n;
    },
    async expire() {
      return 1;
    },
    async ttl() {
      return 1234;
    },
  };
}

const brokenBackend: CounterBackend = {
  async incr() {
    throw new Error("upstash unreachable");
  },
  async expire() {
    throw new Error("upstash unreachable");
  },
};

describe("provisionClientIp", () => {
  it("uses the first x-forwarded-for hop, then x-real-ip, else unknown", () => {
    expect(provisionClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("1.2.3.4");
    expect(provisionClientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(provisionClientIp(new Headers())).toBe("unknown");
    expect(provisionClientIp(new Headers({ "x-forwarded-for": " , 9.9.9.9" }))).toBe("unknown");
  });
});

describe("checkProvisionRateLimit", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const ORIG_URL = process.env.UPSTASH_REDIS_REST_URL;
  beforeEach(() => {
    __resetMemoryRateLimits();
    __resetProvisionRateLimitBackend();
    delete process.env.UPSTASH_REDIS_REST_URL; // never reach the network
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    if (ORIG_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIG_URL;
    __resetProvisionRateLimitBackend();
  });

  it("known IP: per-IP daily limit, independent between IPs", async () => {
    const backend = memoryBackend();
    for (let i = 0; i < PROVISION_PER_IP_PER_DAY; i++) {
      const r = await checkProvisionRateLimit("1.1.1.1", backend);
      expect(r).toMatchObject({ ok: true, mode: "per_ip" });
    }
    const blocked = await checkProvisionRateLimit("1.1.1.1", backend);
    expect(blocked).toMatchObject({ ok: false, mode: "per_ip", limit: PROVISION_PER_IP_PER_DAY, retryAfterSec: 1234 });
    expect((await checkProvisionRateLimit("2.2.2.2", backend)).ok).toBe(true);
  });

  it("unknown IP: not waved through; all such callers share one small bucket", async () => {
    const backend = memoryBackend();
    for (let i = 0; i < PROVISION_UNKNOWN_IP_PER_DAY; i++) {
      expect(await checkProvisionRateLimit("unknown", backend)).toMatchObject({ ok: true, mode: "shared_unknown_ip" });
    }
    expect(await checkProvisionRateLimit("unknown", backend)).toMatchObject({ ok: false, mode: "shared_unknown_ip" });
    // An empty IP string is the same shared bucket, already exhausted.
    expect((await checkProvisionRateLimit("", backend)).ok).toBe(false);
    expect([...backend.keys.keys()].filter((k) => k.includes("unknown-ip"))).toHaveLength(1);
  });

  it("limiter backend throws: falls to a shared limit across ALL IPs, not to allow-all", async () => {
    let allowed = 0;
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR + 20; i++) {
      // A different IP every time: per-IP limiting alone would allow all of these.
      const r = await checkProvisionRateLimit(`10.0.0.${i}`, brokenBackend);
      expect(r.mode).toBe("shared_degraded");
      if (r.ok) allowed++;
    }
    expect(allowed).toBe(PROVISION_DEGRADED_PER_HOUR);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("FAIL_CLOSED"))).toBe(true);
  });

  it("limiter backend not configured: same shared limit across all IPs", async () => {
    let allowed = 0;
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR + 5; i++) {
      const r = await checkProvisionRateLimit(`10.1.0.${i}`, null);
      if (r.ok) allowed++;
      expect(r.mode).toBe("shared_degraded");
    }
    expect(allowed).toBe(PROVISION_DEGRADED_PER_HOUR);
    const blocked = await checkProvisionRateLimit("10.9.9.9", null);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("default backend with Upstash env unset is the degraded shared limit", async () => {
    let allowed = 0;
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR + 3; i++) {
      if ((await checkProvisionRateLimit(`10.2.0.${i}`)).ok) allowed++;
    }
    expect(allowed).toBe(PROVISION_DEGRADED_PER_HOUR);
  });

  it("degraded bucket is shared with unknown-IP callers too", async () => {
    for (let i = 0; i < PROVISION_DEGRADED_PER_HOUR; i++) await checkProvisionRateLimit(`10.3.0.${i}`, brokenBackend);
    expect((await checkProvisionRateLimit("unknown", brokenBackend)).ok).toBe(false);
  });
});

describe("checkClaimEmailAllowance", () => {
  beforeEach(() => __resetMemoryRateLimits());

  it("allows one claim email per address per day", async () => {
    const backend = memoryBackend();
    expect(await checkClaimEmailAllowance("hash-a", backend)).toBe(true);
    expect(await checkClaimEmailAllowance("hash-a", backend)).toBe(false);
    expect(await checkClaimEmailAllowance("hash-b", backend)).toBe(true);
  });

  it("sends nothing when the backend errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkClaimEmailAllowance("hash-a", brokenBackend)).toBe(false);
    spy.mockRestore();
  });

  it("without a backend still caps per address on the instance", async () => {
    expect(await checkClaimEmailAllowance("hash-c", null)).toBe(true);
    expect(await checkClaimEmailAllowance("hash-c", null)).toBe(false);
  });
});

describe("recentProvisionsFromIp", () => {
  const row = (via: string, ip: string, ageMs = 1000) => ({
    signup_attribution: { provisioned_via: via, ip },
    created_at: new Date(Date.now() - ageMs).toISOString(),
  });

  it("counts both routes together and caps at the per-IP limit", async () => {
    const db = createFakeDb();
    db.table("agent_accounts").push(row("provision", "1.1.1.1"), row("provision-free", "1.1.1.1"));
    expect(await recentProvisionsFromIp(db, "1.1.1.1")).toBe("ok");
    db.table("agent_accounts").push(row("provision-free", "1.1.1.1"));
    expect(await recentProvisionsFromIp(db, "1.1.1.1")).toBe("capped");
    expect(await recentProvisionsFromIp(db, "2.2.2.2")).toBe("ok");
  });

  it("ignores accounts older than 24h and accounts not made by provisioning", async () => {
    const db = createFakeDb();
    db.table("agent_accounts").push(
      row("provision", "1.1.1.1", 25 * 3600 * 1000),
      row("provision", "1.1.1.1", 26 * 3600 * 1000),
      row("provision", "1.1.1.1", 27 * 3600 * 1000),
      { signup_attribution: { ip: "1.1.1.1" }, created_at: new Date().toISOString() },
    );
    expect(await recentProvisionsFromIp(db, "1.1.1.1")).toBe("ok");
  });

  it("reports unavailable (caller refuses) when the count query fails", async () => {
    const db = createFakeDb({ failing: { agent_accounts: { message: "db down" } } });
    expect(await recentProvisionsFromIp(db, "1.1.1.1")).toBe("unavailable");
  });
});
