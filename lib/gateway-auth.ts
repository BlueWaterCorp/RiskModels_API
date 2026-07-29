/**
 * Gateway role resolution for `/api/data/*`.
 *
 * These endpoints are **public read by design** — user API keys, JWTs, and
 * anonymous callers all get the same data. The only thing an `Authorization`
 * header can do here is identify a first-party service caller, which the
 * middleware throttle exempts (see `lib/ratelimit/data-gateway-rate-limit.ts`).
 *
 * This module used to export `verifyGatewayAuth()`, which returned
 * `NextResponse | null` and was called as:
 *
 *     const denied = verifyGatewayAuth(request);
 *     if (denied) return denied;
 *
 * Every path through it returned `null`, so `denied` was unreachable — the call
 * sites read like an access-control gate while enforcing nothing. Replaced with
 * a function that returns the role it actually determines, so the public-read
 * decision is explicit at each call site rather than disguised as a check.
 */

/** Who is calling a `/api/data/*` endpoint. */
export type GatewayRole = "service" | "public";

/**
 * Resolve the caller's gateway role.
 *
 * Returns `"service"` only for the first-party service key; everything else —
 * including a valid user API key — is `"public"`. Both roles are served the
 * same payload today; the distinction exists so throttling and observability
 * can tell internal fan-out from external traffic.
 *
 * This never denies a request. Public read is the product.
 */
export function resolveGatewayRole(request: {
  headers: { get(name: string): string | null };
}): GatewayRole {
  const key = process.env.RISKMODELS_API_SERVICE_KEY;
  if (!key) return "public";

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return "public";

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === key ? "service" : "public";
}
