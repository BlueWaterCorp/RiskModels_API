import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * L1/L2/L3 metric keys to check and backfill from EAV if missing in wide table.
 */
const L123_METRIC_KEYS = [
  // L1
  "l1_mkt_hr",
  "l1_mkt_er",
  "l1_res_er",
  "l1_cfr",
  "l1_rr",
  // L2
  "l2_mkt_hr",
  "l2_sec_hr",
  "l2_mkt_er",
  "l2_sec_er",
  "l2_res_er",
  "l2_cfr",
  "l2_rr",
  // L3
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
  "l3_cfr",
  "l3_rr",
];

/**
 * GET /api/data/security-history/latest/:symbol
 *
 * Fetch latest wide-format row from security_history_latest (fast path).
 * Falls back to security_history EAV pivot if L1/L2/L3 data is missing in wide table.
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

  // Check if L1/L2 data is missing (L3 is usually populated, but check all)
  // If any L1/L2 keys are null, try to backfill from EAV
  const needsBackfill = L123_METRIC_KEYS.some(
    (key) => data[key] === null || data[key] === undefined,
  );

  if (needsBackfill && data.teo) {
    try {
      // Query EAV format from security_history for the same teo
      const { data: eavRows, error: eavError } = await supabase
        .from("security_history")
        .select("metric_key, metric_value")
        .eq("symbol", symbol)
        .eq("periodicity", periodicity)
        .eq("teo", data.teo)
        .in("metric_key", L123_METRIC_KEYS);

      if (!eavError && eavRows && eavRows.length > 0) {
        // Merge EAV data into the wide row
        for (const row of eavRows) {
          if (row.metric_value !== null && row.metric_value !== undefined) {
            data[row.metric_key] = row.metric_value;
          }
        }
      }
    } catch (e) {
      // Log but don't fail the request — return what we have
      console.error(
        `[data/security-history/latest] EAV backfill failed for ${symbol}:`,
        e,
      );
    }
  }

  return NextResponse.json(data);
}
