import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/trading-calendar?periodicity=daily
 *
 * Fetch all trading calendar dates (teo values).
 */
export async function GET(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const sp = request.nextUrl.searchParams;
  const periodicity = sp.get("periodicity") ?? "daily";

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("trading_calendar")
    .select("teo")
    .eq("periodicity", periodicity)
    .order("teo", { ascending: true });

  if (error) {
    console.error("[data/trading-calendar] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({
    dates: (data ?? []).map((r: { teo: string }) => r.teo),
  });
}
