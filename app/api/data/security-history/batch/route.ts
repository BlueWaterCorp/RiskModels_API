import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBatchHistory,
  type V3MetricKey,
  type V3Periodicity,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import {
  isRestrictedSourceSymbol,
  RAW_SERIES_KEYS,
  requestsRawRestricted,
  RESTRICTED_SOURCE_NOTE,
  stripRawRestricted,
  stripRawSeries,
} from "@/lib/data-license";

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

    // Key by symbol. EODHD Exhibit B(e)/(f): raw fields (close price, market
    // cap) are permitted only per-symbol/per-call — never in a bulk batch — so
    // strip them from every wide row here regardless of caller auth.
    const results: Record<string, unknown> = {};
    for (const row of allRows) {
      const r = row as Record<string, unknown> & { symbol: string };
      // GATE 2: CRSP derived-only symbols also lose returns_gross, not just
      // the Exhibit-B fields.
      results[r.symbol] = isRestrictedSourceSymbol(r.symbol)
        ? stripRawSeries(r)
        : stripRawRestricted(r);
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

  // EODHD Exhibit B(e)/(f): raw fields are permitted only per-symbol/per-call.
  // A multi-symbol batch is bulk by definition, so raw keys are never allowed
  // here — direct callers to the per-symbol endpoint. Derived keys are fine.
  if (requestsRawRestricted(keys)) {
    return NextResponse.json(
      {
        error:
          "Raw fields (price_close, market_cap) are not available in batch " +
          "requests. Fetch them per-symbol via GET /api/data/security-history/:symbol.",
      },
      { status: 403 },
    );
  }

  const metricKeys = keys as V3MetricKey[];
  const per = periodicity as V3Periodicity;

  try {
    const rows = await fetchBatchHistory(symbols, metricKeys, {
      periodicity: per,
      startDate: body.start,
      endDate: body.end,
      orderBy: "asc",
    });

    // GATE 2: raw-series rows (returns_gross included — it is not in the
    // Exhibit-B batch 403 above) are dropped for CRSP derived-only symbols.
    const restrictedInBatch = symbols.filter(isRestrictedSourceSymbol);
    const data = restrictedInBatch.length
      ? rows.filter(
          (r) =>
            !(
              RAW_SERIES_KEYS.has(r.metric_key) &&
              isRestrictedSourceSymbol(r.symbol)
            ),
        )
      : rows;

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
        ...(restrictedInBatch.length
          ? { ...RESTRICTED_SOURCE_NOTE, restricted_symbols: restrictedInBatch }
          : {}),
      }),
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
