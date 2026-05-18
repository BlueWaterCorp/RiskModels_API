import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { resolveFundsByIds } from "@/lib/dal/funds-engine";

export const dynamic = "force-dynamic";

const MAX_BATCH = 1000;

/**
 * POST /api/data/funds/batch
 *
 * Body: { fund_ids: string[] }   — up to 1000 bw_fund_ids per request
 * Returns: { results: { [bw_fund_id]: { fund, latest } } }
 *
 * Mirrors POST /api/data/symbols/batch. Mostly used by the SDK to hydrate a
 * portfolio's full registry+latest payload in one call.
 */
export async function POST(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  let body: { fund_ids?: unknown };
  try {
    body = (await request.json()) as { fund_ids?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = body.fund_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "fund_ids array is required" },
      { status: 400 },
    );
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Max ${MAX_BATCH} fund_ids per request` },
      { status: 400 },
    );
  }
  if (!ids.every((x): x is string => typeof x === "string" && x.length > 0)) {
    return NextResponse.json(
      { error: "fund_ids must be a non-empty string array" },
      { status: 400 },
    );
  }

  const map = await resolveFundsByIds(ids);
  const results: Record<string, unknown> = {};
  for (const [id, value] of map.entries()) {
    results[id] = value;
  }

  return NextResponse.json({ results });
}
