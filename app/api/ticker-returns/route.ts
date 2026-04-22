import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchHistoryWithSource,
  pivotHistory,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody, buildEtag, maybe304 } from "@/lib/dal/response-headers";
import { formatResponse, parseFormat } from "@/lib/api/format-response";
import { TickerReturnsRequestSchema } from "@/lib/api/schemas";

export const runtime = "nodejs";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = TickerReturnsRequestSchema.safeParse({
      ticker: searchParams.get("ticker"),
      years: searchParams.get("years") || "1",
      format: parseFormat(searchParams, request.headers.get("accept")),
    });

    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { ticker, years, format } = validation.data;

    const symbolRecord = await resolveSymbolByTicker(ticker);
    if (!symbolRecord) {
      return NextResponse.json({ error: "Ticker not found" }, { status: 404, headers: getCorsHeaders(origin) });
    }

    const metadata = await getRiskMetadata();
    const etag = buildEtag(metadata.data_as_of, `${ticker}-${years}-${format}`);
    const corsHeaders = getCorsHeaders(origin);
    const notModified = maybe304(request, etag, corsHeaders);
    if (notModified) {
      addMetadataHeaders(notModified, metadata);
      return notModified;
    }

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const startDateStr = startDate.toISOString().split("T")[0];

    // ETFs live in ds_etf.zarr and have no L1/L2/L3 decomposition. Only request
    // daily-role keys for them — the hedge/returns zarr stores don't carry ETF
    // rows and asking skips a pointless open. Stocks still get the full pull.
    const isEtf = symbolRecord.asset_type === "etf";
    const keys: V3MetricKey[] = isEtf
      ? ["returns_gross", "price_close"]
      : [
          "returns_gross",
          "price_close",
          "l1_cfr",
          "l2_cfr",
          "l3_cfr",
          "l3_mkt_hr",
          "l3_sec_hr",
          "l3_sub_hr",
          "l3_mkt_er",
          "l3_sec_er",
          "l3_sub_er",
          "l3_res_er",
        ];

    const fetchStart = performance.now();
    let rows: Awaited<ReturnType<typeof fetchHistoryWithSource>>["rows"];
    let dataSource: Awaited<ReturnType<typeof fetchHistoryWithSource>>["dataSource"];
    try {
      ({ rows, dataSource } = await fetchHistoryWithSource(symbolRecord.symbol, keys, {
        periodicity: "daily",
        startDate: startDateStr,
        orderBy: "asc",
      }));
    } catch (error) {
      console.error("[ticker-returns] history fetch failed", {
        ticker,
        symbol: symbolRecord.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          error: "History temporarily unavailable",
          message: "Upstream history store is unreachable. Please retry.",
          retry_after_seconds: 10,
        },
        {
          status: 503,
          headers: {
            ...getCorsHeaders(origin),
            "Retry-After": "10",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const pivoted = pivotHistory(rows);
    const histRange: [string, string] =
      pivoted.length > 0
        ? [pivoted[0]!.teo, pivoted[pivoted.length - 1]!.teo]
        : ["", ""];
    // ETF rows carry only what applies to ETFs. Stock rows keep the full
    // L1/L2/L3 surface. Keys missing from the row map get omitted from JSON,
    // dropped from the parquet/csv schema, and turn into absent columns
    // in the SDK DataFrame — no more all-None L* noise for SPY et al.
    const data = pivoted.map((row) => {
      const base: Record<string, string | number | null> = {
        date: row.teo,
        returns_gross: row.returns_gross ?? null,
        price_close: row.price_close ?? null,
      };
      if (isEtf) return base;
      base.l1_cfr = row.l1_cfr ?? null;
      base.l2_cfr = row.l2_cfr ?? null;
      base.l3_cfr = row.l3_cfr ?? null;
      base.l3_mkt_hr = row.l3_mkt_hr ?? null;
      base.l3_sec_hr = row.l3_sec_hr ?? null;
      base.l3_sub_hr = row.l3_sub_hr ?? null;
      base.l3_mkt_er = row.l3_mkt_er ?? null;
      base.l3_sec_er = row.l3_sec_er ?? null;
      base.l3_sub_er = row.l3_sub_er ?? null;
      base.l3_res_er = row.l3_res_er ?? null;
      return base;
    });

    const ext = format === "parquet" ? "parquet" : format === "csv" ? "csv" : "json";
    const filename = `${ticker}_returns_${years}y.${ext}`;
    const fetchLatency = Math.round(performance.now() - fetchStart);

    const response = await formatResponse({
      rows: data,
      format,
      filename,
      extraHeaders: {
        ...getCorsHeaders(origin),
        ETag: etag,
        "X-Data-Fetch-Latency-Ms": String(fetchLatency),
      } as Record<string, string>,
      jsonPayload: {
        symbol: symbolRecord.symbol,
        ticker: symbolRecord.ticker,
        asset_type: symbolRecord.asset_type,
        periodicity: "daily",
        data,
        meta: isEtf
          ? {
              market_etf: "SPY",
              sector_etf: null,
              subsector_etf: null,
              universe: "US_ETF",
            }
          : {
              market_etf: "SPY",
              sector_etf: symbolRecord.sector_etf || "XLK",
              subsector_etf: symbolRecord.subsector_etf ?? null,
              universe: "US_EQUITY",
            },
        _metadata: buildMetadataBody(metadata, {
          data_source: dataSource,
          range: histRange[0] && histRange[1] ? histRange : undefined,
        }),
      },
    });
    addMetadataHeaders(response, metadata);
    return response;
  },
  { capabilityId: "ticker-returns" },
);
