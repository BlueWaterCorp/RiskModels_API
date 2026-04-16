import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/metadata
 *
 * Risk model metadata: latest data date, universe size, model version.
 * Mirrors Risk_Models' getRiskMetadata() from lib/dal/risk-metadata.ts.
 */
export async function GET(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const supabase = createAdminClient();

  // Latest date across security_history_latest (pipeline-maintained wide table).
  // Previously read from security_history (EAV) — migrated as part of the pure-Zarr cutover.
  const { data: latestRow } = await supabase
    .from("security_history_latest")
    .select("teo")
    .eq("periodicity", "daily")
    .order("teo", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dataAsOf =
    latestRow?.teo ?? new Date().toISOString().split("T")[0];

  // Universe size (stocks only)
  const { count: universeCount } = await supabase
    .from("symbols")
    .select("*", { count: "exact", head: true })
    .eq("asset_type", "stock");

  return NextResponse.json({
    data_as_of: dataAsOf,
    universe_size: universeCount ?? 0,
    factor_set_id: "SPY_uni_mc_3000",
    factors: [
      "SPY", "XLK", "XLF", "XLV", "XLE", "XLI",
      "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    ],
  });
}
