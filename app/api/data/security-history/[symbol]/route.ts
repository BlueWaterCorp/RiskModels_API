import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/security-history/:symbol
 *
 * Fetch time-series history from security_history (long-form EAV).
 *
 * Query params:
 *   - keys: comma-separated V3 metric keys (required)
 *   - periodicity: "daily" | "monthly" (default: "daily")
 *   - start: YYYY-MM-DD start date
 *   - end: YYYY-MM-DD end date
 *   - order: "asc" | "desc" (default: "asc")
 *   - page_size: number (default: 5000, max: 10000)
 *   - offset: number (default: 0)
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
  const keysParam = sp.get("keys");
  if (!keysParam) {
    return NextResponse.json(
      { error: "keys query param is required (comma-separated metric keys)" },
      { status: 400 },
    );
  }

  const keys = keysParam.split(",").map((k) => k.trim()).filter(Boolean);
  const periodicity = sp.get("periodicity") ?? "daily";
  const startDate = sp.get("start");
  const endDate = sp.get("end");
  const order = sp.get("order") ?? "asc";
  const pageSize = Math.min(Number(sp.get("page_size") ?? 5000), 10000);
  const offset = Number(sp.get("offset") ?? 0);

  const supabase = createAdminClient();

  let query = supabase
    .from("security_history")
    .select("symbol, teo, periodicity, metric_key, metric_value")
    .eq("symbol", symbol)
    .eq("periodicity", periodicity)
    .in("metric_key", keys);

  if (startDate) query = query.gte("teo", startDate);
  if (endDate) query = query.lte("teo", endDate);

  query = query
    .order("teo", { ascending: order === "asc" })
    .range(offset, offset + pageSize - 1);

  const { data, error } = await query;

  if (error) {
    console.error(`[data/security-history] Error for ${symbol}:`, error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    pagination: {
      offset,
      page_size: pageSize,
      returned: (data ?? []).length,
      has_more: (data ?? []).length === pageSize,
    },
  });
}
