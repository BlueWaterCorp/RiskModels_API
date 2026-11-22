/**
 * Rate limit for the unauthenticated provisioning routes
 * (`POST /api/auth/provision`, `POST /api/auth/provision-free`).
 *
 * Each call creates an auth user, an account and a key, so the limit must not
 * disappear when its inputs do. It fails closed:
 *
 *   - Known client IP, Upstash healthy: per-IP daily window, shared by both
 *     routes (one caller cannot double the allowance by alternating routes).
 *   - Unknown client IP: every such caller shares one small bucket.
 *   - Upstash unconfigured or erroring: every caller, whatever the IP, shares
 *     one small per-instance in-memory bucket. Never "allow everything".
 *
 * The in-memory bucket is per serverless instance, so its real ceiling is
 * (limit x live instances). It bounds the surface; it is not exact accounting.
 * Each degraded decision logs `[provision-rl] FAIL_CLOSED`.
 */
import { Redis } from "@upstash/redis";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";
import { checkMemoryRateLimit } from "@/lib/ratelimit/memory-fallback";

/** Accounts one IP may provision per rolling day, across both routes. */
export const PROVISION_PER_IP_PER_DAY = 3;
/** Shared allowance for all callers whose IP cannot be determined. */
export const PROVISION_UNKNOWN_IP_PER_DAY = 5;
/** Shared per-instance allowance for all callers while the limiter backend is down. */
export const PROVISION_DEGRADED_PER_HOUR = 5;
/** Claim emails one contact address may be sent per day. */
export const CLAIM_EMAILS_PER_ADDRESS_PER_DAY = 1;

const DAY_SEC = 24 * 60 * 60;
const HOUR_SEC = 60 * 60;
const KEY_PREFIX = "riskmodels:provision:rl";

export type ProvisionLimitMode = "per_ip" | "shared_unknown_ip" | "shared_degraded";

export interface ProvisionLimitResult {
  ok: boolean;
  mode: ProvisionLimitMode;
  limit: number;
  retryAfterSec: number;
}

/** Minimal counter the limiter needs; lets tests inject a failing backend. */
export interface CounterBackend {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl?(key: string): Promise<number>;
}

let _redis: CounterBackend | null | undefined;
function defaultBackend(): CounterBackend | null {
  if (_redis !== undefined) return _redis;
  _redis = isUpstashRedisConfigured()
    ? (new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }) as unknown as CounterBackend)
    : null;
  return _redis;
}

/** Test seam: forget the cached Upstash client. */
export function __resetProvisionRateLimitBackend(): void {
  _redis = undefined;
}

/** First hop of x-forwarded-for, else x-real-ip, else "unknown". */
export function provisionClientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first.slice(0, 128);
  const real = headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 128) : "unknown";
}

async function fixedWindow(
  backend: CounterBackend,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const count = await backend.incr(key);
  if (count === 1) await backend.expire(key, windowSec);
  if (count <= limit) return { ok: true, retryAfterSec: 0 };
  let retryAfterSec = windowSec;
  if (backend.ttl) {
    const ttl = await backend.ttl(key).catch(() => -1);
    if (ttl > 0) retryAfterSec = ttl;
    // A key with no expiry would block forever; give it one.
    if (ttl === -1) await backend.expire(key, windowSec).catch(() => {});
  }
  return { ok: false, retryAfterSec };
}

function degraded(reason: string): ProvisionLimitResult {
  console.error(
    `[provision-rl] FAIL_CLOSED reason=${reason} — all callers share ${PROVISION_DEGRADED_PER_HOUR}/hour on this instance`,
  );
  const m = checkMemoryRateLimit(
    "provision:shared-degraded",
    PROVISION_DEGRADED_PER_HOUR,
    HOUR_SEC * 1000,
  );
  return {
    ok: m.ok,
    mode: "shared_degraded",
    limit: PROVISION_DEGRADED_PER_HOUR,
    retryAfterSec: m.retryAfterSec,
  };
}

/**
 * Consume one provisioning attempt for this caller.
 * @param ip      result of {@link provisionClientIp}
 * @param backend override for tests; defaults to Upstash when configured
 */
export async function checkProvisionRateLimit(
  ip: string,
  backend: CounterBackend | null = defaultBackend(),
): Promise<ProvisionLimitResult> {
  if (!backend) return degraded("limiter_unconfigured");

  const unknownIp = !ip || ip === "unknown";
  const mode: ProvisionLimitMode = unknownIp ? "shared_unknown_ip" : "per_ip";
  const limit = unknownIp ? PROVISION_UNKNOWN_IP_PER_DAY : PROVISION_PER_IP_PER_DAY;
  const key = unknownIp ? `${KEY_PREFIX}:unknown-ip` : `${KEY_PREFIX}:ip:${ip}`;

  try {
    const r = await fixedWindow(backend, key, limit, DAY_SEC);
    return { ok: r.ok, mode, limit, retryAfterSec: r.retryAfterSec };
  } catch (err) {
    console.error("[provision-rl] limiter backend error:", err);
    return degraded("limiter_error");
  }
}

/**
 * Whether a claim email may be sent to this address now. Keyed on a hash of
 * the address, never the address itself. With no backend configured it counts
 * per instance; on a backend error no email is sent (the key is still issued
 * and the caller reports the skip).
 */
export async function checkClaimEmailAllowance(
  addressHash: string,
  backend: CounterBackend | null = defaultBackend(),
): Promise<boolean> {
  if (!backend) {
    return checkMemoryRateLimit(
      `provision:claim-email:${addressHash}`,
      CLAIM_EMAILS_PER_ADDRESS_PER_DAY,
      DAY_SEC * 1000,
    ).ok;
  }
  try {
    const r = await fixedWindow(
      backend,
      `${KEY_PREFIX}:claim-email:${addressHash}`,
      CLAIM_EMAILS_PER_ADDRESS_PER_DAY,
      DAY_SEC,
    );
    return r.ok;
  } catch (err) {
    console.error("[provision-rl] claim-email limiter error (not sending):", err);
    return false;
  }
}

/** 429 body + headers shared by both routes. */
export function provisionRateLimitBody(result: ProvisionLimitResult, latencyMs: number) {
  const scope =
    result.mode === "per_ip"
      ? `${result.limit} accounts per IP per 24h across /api/auth/provision and /api/auth/provision-free`
      : result.mode === "shared_unknown_ip"
        ? "a shared limit applies to requests whose client IP cannot be determined"
        : "a temporary shared limit applies while the rate limiter is unavailable";
  return {
    error: "Rate limit exceeded",
    message: `Provisioning is rate limited (${scope}). A person can create a key with $20 of credit at https://riskmodels.app/get-key.`,
    _agent: {
      action: "wait_or_use_get_key",
      retry_after_seconds: result.retryAfterSec,
      limit_scope: result.mode,
      human_url: "https://riskmodels.app/get-key",
      latency_ms: latencyMs,
    },
  };
}

type CountClient = { from: (table: string) => any };

/**
 * Durable second layer, independent of Redis: accounts already provisioned
 * from this IP in the last 24h, read from `agent_accounts.signup_attribution`.
 * `unavailable` (query failed) is for the caller to refuse on, not to ignore.
 */
export async function recentProvisionsFromIp(
  admin: CountClient,
  ip: string,
): Promise<"ok" | "capped" | "unavailable"> {
  if (!ip || ip === "unknown") return "ok"; // covered by the shared unknown-IP bucket
  const since = new Date(Date.now() - DAY_SEC * 1000).toISOString();
  const { count, error } = await admin
    .from("agent_accounts")
    .select("id", { count: "exact", head: true })
    .in("signup_attribution->>provisioned_via", ["provision", "provision-free"])
    .eq("signup_attribution->>ip", ip)
    .gte("created_at", since);
  if (error || typeof count !== "number") return "unavailable";
  return count >= PROVISION_PER_IP_PER_DAY ? "capped" : "ok";
}
