import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { resolveSecurityIdentity, type ResolveRequest } from "@/lib/identity/resolve";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const rpm = Number.parseInt(process.env.IDENTITY_RESOLVE_IP_RPM ?? "60", 10);
const effectiveRpm = Number.isFinite(rpm) && rpm > 0 ? rpm : 60;
const QTY = /^\d+(\.\d+)?$/;

/**
 * GET /api/identity/resolve
 *
 * Which security an identifier meant on a date, and what a holding of it became by `as_of`
 * through reviewed corporate actions (ticker changes, ADR conversions, splits, spin-offs and
 * distributions, cash mergers, cancellations). Free while reviewed coverage is limited.
 *
 * Query: identifier (ticker or bw_sym_id), as_of (YYYY-MM-DD, default today), acquired_on
 * (YYYY-MM-DD, optional: carry a holding from that date), quantity (default 100),
 * identifier_type (ticker | bw_sym_id, default inferred), known_as_of (reproduce an earlier
 * answer), fractions (apply | exact), election.<event_id>=<package>.
 *
 * AUTH: none. `skipBilling: true` makes it public; it is throttled per caller IP
 * (IDENTITY_RESOLVE_IP_RPM, default 60 per minute), as documented in OPENAPI_SPEC.yaml.
 */
async function handler(request: NextRequest, _context: BillingContext) {
  const p = request.nextUrl.searchParams;
  const identifier = (p.get("identifier") ?? "").trim();
  if (!identifier || identifier.length > 40) {
    return NextResponse.json({ error: "identifier is required (ticker or bw_sym_id)" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const as_of = p.get("as_of") ?? today;
  const acquired_on = p.get("acquired_on");
  const known_as_of = p.get("known_as_of");
  for (const [k, v] of [["as_of", as_of], ["acquired_on", acquired_on], ["known_as_of", known_as_of]] as const) {
    if (v != null && (!ISO.test(v) || Number.isNaN(Date.parse(v)))) {
      return NextResponse.json({ error: `${k} must be YYYY-MM-DD` }, { status: 400 });
    }
  }
  if (acquired_on && acquired_on > as_of) {
    return NextResponse.json({ error: "acquired_on is after as_of" }, { status: 400 });
  }
  const quantity = p.get("quantity") ?? "100";
  if (!QTY.test(quantity)) {
    return NextResponse.json({ error: "quantity must be a non-negative decimal" }, { status: 400 });
  }
  const fractions = p.get("fractions") ?? "apply";
  if (fractions !== "apply" && fractions !== "exact") {
    return NextResponse.json({ error: "fractions must be apply or exact" }, { status: 400 });
  }
  const typeParam = p.get("identifier_type");
  if (typeParam && typeParam !== "ticker" && typeParam !== "bw_sym_id") {
    return NextResponse.json({ error: "identifier_type must be ticker or bw_sym_id" }, { status: 400 });
  }
  const identifier_type = (typeParam ?? (/^BW-/i.test(identifier) ? "bw_sym_id" : "ticker")) as ResolveRequest["identifier_type"];
  const elections: Record<string, string> = {};
  for (const [k, v] of p.entries()) if (k.startsWith("election.")) elections[k.slice(9)] = v;

  try {
    const body = await resolveSecurityIdentity({
      identifier: identifier_type === "ticker" ? identifier.toUpperCase() : identifier,
      identifier_type,
      as_of,
      acquired_on,
      quantity,
      known_as_of,
      fractions,
      elections,
    });
    return NextResponse.json(body, {
      headers: { "X-Identity-Status": body.status, "X-Identity-Coverage": body.coverage },
    });
  } catch (error) {
    console.error("[identity/resolve]", error);
    return NextResponse.json(
      { error: "identity data unavailable", status: "unavailable", coverage: "unknown" },
      { status: 503 },
    );
  }
}

export const GET = withBilling(handler, {
  capabilityId: "identity-resolve",
  skipBilling: true,
  publicIpRateLimitPerMinute: effectiveRpm,
});
