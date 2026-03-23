import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { resolveSymbolByTicker, fetchHistory, pivotHistory } from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody, buildEtag, maybe304 } from "@/lib/dal/response-headers";
import { formatResponse, parseFormat } from "@/lib/api/format-response";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");
    const ticker = searchParams.get("ticker")?.toUpperCase();
    const years = parseInt(searchParams.get("years") || "1", 10);
    const format = parseFormat(searchParams, request.headers.get("accept"));

    if (!ticker) {
      return NextResponse.json({ error: "Missing ticker" }, { status: 400, headers: getCorsHeaders(origin) });
    }

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

    const rows = await fetchHistory(symbolRecord.symbol, [
      "returns_gross",
      "price_close",
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
    const data = pivoted.map((row) => ({
      date: row.teo,
      returns_gross: row.returns_gross ?? null,
      price_close: row.price_close ?? null,
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

    const response = await formatResponse({
      rows: data,
      format,
      filename,
      extraHeaders: { ...getCorsHeaders(origin), ETag: etag } as Record<string, string>,
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
        _metadata: buildMetadataBody(metadata),
      },
    });
    addMetadataHeaders(response, metadata);
    return response;
  },
  { capabilityId: "ticker-returns" },
);
