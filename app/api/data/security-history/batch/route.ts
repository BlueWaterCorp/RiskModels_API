import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import {
  fetchBatchHistory,
  type V3MetricKey,
  type V3Periodicity,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      {
        error: "keys array is required for history mode (or use latest: true)",
      },
      { status: 400 },
    );
  }

  const metricKeys = keys as V3MetricKey[];
  const per = periodicity as V3Periodicity;

  try {
    const data = await fetchBatchHistory(symbols, metricKeys, {
      periodicity: per,
      startDate: body.start,
      endDate: body.end,
      orderBy: "asc",
    });

    const teos = [...new Set(data.map((r) => r.teo))].sort();
    const histRange: [string, string] =
      teos.length > 0 ? [teos[0]!, teos[teos.length - 1]!] : ["", ""];

    const metadata = await getRiskMetadata();

    return NextResponse.json({
      data,
      _metadata: buildMetadataBody(metadata, {
        data_source: "zarr",
        range:
          histRange[0] && histRange[1] ? histRange : undefined,
      }),
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
