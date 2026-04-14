import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import {
  fetchHistory,
  isZarrHistoryPath,
  type V3MetricKey,
  type V3Periodicity,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/data/security-history/:symbol
 *
 * Time-series history (long-form EAV). Daily standard metrics are served from
 * consolidated Zarr on GCS; monthly / unsupported keys use Supabase.
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
  const periodicity = (sp.get("periodicity") ?? "daily") as V3Periodicity;
  const startDate = sp.get("start") ?? undefined;
  const endDate = sp.get("end") ?? undefined;
  const order = sp.get("order") ?? "asc";
  const pageSize = Math.min(Number(sp.get("page_size") ?? 5000), 10000);
  const offset = Number(sp.get("offset") ?? 0);

  const metricKeys = keys as V3MetricKey[];

  try {
    const rows = await fetchHistory(symbol, metricKeys, {
      periodicity,
      startDate,
      endDate,
      orderBy: order === "asc" ? "asc" : "desc",
    });

    const paged = rows.slice(offset, offset + pageSize);

    const teos = [...new Set(rows.map((r) => r.teo))].sort();
    const histRange: [string, string] =
      teos.length > 0 ? [teos[0]!, teos[teos.length - 1]!] : ["", ""];

    const metadata = await getRiskMetadata();
    const fromZarr = isZarrHistoryPath(metricKeys, periodicity);

    return NextResponse.json({
      data: paged,
      pagination: {
        offset,
        page_size: pageSize,
        returned: paged.length,
        has_more: offset + paged.length < rows.length,
      },
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
