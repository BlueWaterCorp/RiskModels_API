import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchHistoryWithSource,
  pivotHistory,
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

    const fetchStart = performance.now();
    const { rows, dataSource } = await fetchHistoryWithSource(symbolRecord.symbol, [
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
    ], {
      periodicity: "daily",
      startDate: startDateStr,
      orderBy: "asc",
    });

    const pivoted = pivotHistory(rows);
    const histRange: [string, string] =
      pivoted.length > 0
        ? [pivoted[0]!.teo, pivoted[pivoted.length - 1]!.teo]
        : ["", ""];
    const data = pivoted.map((row) => ({
      date: row.teo,
      returns_gross: row.returns_gross ?? null,
      price_close: row.price_close ?? null,
      l1_cfr: row.l1_cfr ?? null,
      l2_cfr: row.l2_cfr ?? null,
      l3_cfr: row.l3_cfr ?? null,
      l3_mkt_hr: row.l3_mkt_hr ?? null,
      l3_sec_hr: row.l3_sec_hr ?? null,
      l3_sub_hr: row.l3_sub_hr ?? null,
      l3_mkt_er: row.l3_mkt_er ?? null,
      l3_sec_er: row.l3_sec_er ?? null,
      l3_sub_er: row.l3_sub_er ?? null,
      l3_res_er: row.l3_res_er ?? null,
    }));

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
        periodicity: "daily",
        data,
        meta: {
          market_etf: "SPY",
          sector_etf: symbolRecord.sector_etf || "XLK",
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
