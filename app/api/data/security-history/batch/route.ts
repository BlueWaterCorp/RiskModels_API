import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/data/security-history/batch
 *
 * Batch fetch from security_history or security_history_latest.
 *
 * Body: {
 *   symbols: string[],
 *   keys?: string[],          // metric keys (for long-form history)
 *   periodicity?: string,     // default "daily"
 *   start?: string,           // YYYY-MM-DD
 *   end?: string,             // YYYY-MM-DD
 *   latest?: boolean,         // if true, fetch from security_history_latest (wide)
 * }
 */
export async function POST(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  let body: {
    symbols?: string[];
    keys?: string[];
    periodicity?: string;
    start?: string;
    end?: string;
    latest?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbols = body.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json(
      { error: "symbols array is required" },
      { status: 400 },
    );
  }

  if (symbols.length > 500) {
    return NextResponse.json(
      { error: "Max 500 symbols per request" },
      { status: 400 },
    );
  }

  const periodicity = body.periodicity ?? "daily";
  const supabase = createAdminClient();

  // --- Latest mode (wide table) ---
  if (body.latest) {
    const PAGE_SIZE = 500;
    const allRows: Record<string, unknown>[] = [];

    for (let i = 0; i < symbols.length; i += PAGE_SIZE) {
      const batch = symbols.slice(i, i + PAGE_SIZE);
      const { data, error } = await supabase
        .from("security_history_latest")
        .select("*")
        .in("symbol", batch)
        .eq("periodicity", periodicity);

      if (error) {
        console.error("[data/security-history/batch] latest error:", error);
        continue;
      }
      if (data) allRows.push(...data);
    }

    // Key by symbol
    const results: Record<string, unknown> = {};
    for (const row of allRows) {
      results[(row as { symbol: string }).symbol] = row;
    }

    return NextResponse.json({ results });
  }

  // --- History mode (long-form EAV) ---
  const keys = body.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return NextResponse.json(
      { error: "keys array is required for history mode (or use latest: true)" },
      { status: 400 },
    );
  }

  let query = supabase
    .from("security_history")
    .select("symbol, teo, periodicity, metric_key, metric_value")
    .in("symbol", symbols)
    .eq("periodicity", periodicity)
    .in("metric_key", keys);

  if (body.start) query = query.gte("teo", body.start);
  if (body.end) query = query.lte("teo", body.end);

  query = query.order("teo", { ascending: true });

  const { data, error } = await query;

  if (error) {
    console.error("[data/security-history/batch] history error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
