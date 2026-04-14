import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import {
  fetchBatchHistory,
  isZarrHistoryPath,
  type V3MetricKey,
  type V3Periodicity,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 * Backfill L1/L2/L3 data from EAV (security_history) for wide rows that have nulls.
 */
async function backfillL123FromEAV(
  supabase: ReturnType<typeof createAdminClient>,
  rows: Record<string, unknown>[],
  periodicity: string,
): Promise<void> {
  // Find rows that need backfill and group by teo
  const rowsByTeo: Map<string, Record<string, unknown>[]> = new Map();

  for (const row of rows) {
    const teo = row.teo as string | undefined;
    if (!teo) continue;

    // Check if any L1/L2 keys are null
    const needsBackfill = L123_METRIC_KEYS.some(
      (key) => row[key] === null || row[key] === undefined,
    );

    if (needsBackfill) {
      if (!rowsByTeo.has(teo)) rowsByTeo.set(teo, []);
      rowsByTeo.get(teo)!.push(row);
    }
  }

  if (rowsByTeo.size === 0) return;

  // For each teo date, fetch EAV data and backfill
  for (const [teo, rowsToBackfill] of rowsByTeo) {
    const symbols = rowsToBackfill.map((r) => r.symbol as string);

    try {
      const { data: eavRows, error: eavError } = await supabase
        .from("security_history")
        .select("symbol, metric_key, metric_value")
        .in("symbol", symbols)
        .eq("periodicity", periodicity)
        .eq("teo", teo)
        .in("metric_key", L123_METRIC_KEYS);

      if (eavError || !eavRows) continue;

      // Build lookup: symbol -> key -> value
      const eavLookup: Record<string, Record<string, number>> = {};
      for (const row of eavRows) {
        const sym = row.symbol as string;
        if (!eavLookup[sym]) eavLookup[sym] = {};
        eavLookup[sym][row.metric_key as string] = row.metric_value as number;
      }

      // Backfill null values
      for (const row of rowsToBackfill) {
        const sym = row.symbol as string;
        const eavData = eavLookup[sym];
        if (!eavData) continue;

        for (const key of L123_METRIC_KEYS) {
          if (
            (row[key] === null || row[key] === undefined) &&
            eavData[key] !== undefined
          ) {
            row[key] = eavData[key];
          }
        }
      }
    } catch (e) {
      console.error(
        `[security-history/batch] EAV backfill failed for teo=${teo}:`,
        e,
      );
    }
  }
}

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

    // Backfill L1/L2/L3 from EAV if missing in wide table
    await backfillL123FromEAV(supabase, allRows, periodicity);

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
    const fromZarr = isZarrHistoryPath(metricKeys, per);

    return NextResponse.json({
      data,
      _metadata: buildMetadataBody(metadata, {
        data_source: fromZarr ? "zarr" : "supabase",
        range:
          histRange[0] && histRange[1] ? histRange : undefined,
      }),
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
