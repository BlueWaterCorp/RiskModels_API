/**
 * Best-effort idempotency for billed POSTs (requires Upstash Redis).
 * Keyed by user + fingerprint of (idempotency header + capability + body).
 */

import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";

const TTL_SEC = 24 * 60 * 60;
const PREFIX = "idemp:v1";

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  if (!isUpstashRedisConfigured()) return null;
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return _redis;
}

export function idempotencyFingerprint(
  idempotencyKey: string,
  capabilityId: string,
  bodyText: string,
): string {
  const h = createHash("sha256");
  h.update(idempotencyKey);
  h.update("\0");
  h.update(capabilityId);
  h.update("\0");
  h.update(bodyText);
  return h.digest("hex");
}

export type CachedIdempotentResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

export async function getIdempotentResponse(
  userId: string,
  fingerprint: string,
): Promise<CachedIdempotentResponse | null> {
  const r = redis();
  if (!r) return null;
  try {
    const raw = await r.get<string>(`${PREFIX}:${userId}:${fingerprint}`);
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw) as CachedIdempotentResponse;
  } catch {
    return null;
  }
}

export async function setIdempotentResponse(
  userId: string,
  fingerprint: string,
  payload: CachedIdempotentResponse,
): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    await r.set(`${PREFIX}:${userId}:${fingerprint}`, JSON.stringify(payload), {
      ex: TTL_SEC,
    });
  } catch (e) {
    console.error("[Idempotency] cache set failed (non-fatal):", e);
  }
}
