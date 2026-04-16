import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/security-history/latest/:symbol
 *
 * Fetch latest wide-format row from security_history_latest.
 *
 * As of the pure-Zarr SSOT cutover, the wide `_latest` row is authoritative —
 * no more EAV backfill from `security_history`. If L1/L2/L3 columns are
 * missing here, the fix is in the pipeline writer (sync_supabase_1f.py),
 * not an API-side patch.
 *
 * Query params:
 *   - periodicity: "daily" | "monthly" (default: "daily")
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { symbol } = await params;
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const periodicity = sp.get("periodicity") ?? "daily";

  const supabase = createAdminClient();

  // Fast path: security_history_latest (pipeline-maintained wide table)
  const { data, error } = await supabase
    .from("security_history_latest")
    .select("*")
    .eq("symbol", symbol)
    .eq("periodicity", periodicity)
    .maybeSingle();

  if (error) {
    console.error(`[data/security-history/latest] Error for ${symbol}:`, error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "No latest data found for symbol" },
      { status: 404 },
    );
  }

  return NextResponse.json(data);
}
