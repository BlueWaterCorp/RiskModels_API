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
import {
  addMetadataHeaders,
  buildAgentBody,
  buildMetadataBody,
  buildEtag,
  maybe304,
} from "@/lib/dal/response-headers";
import { classifyEmptyEtfReturns, ETF_REASON_CODES } from "@/lib/dal/etf-universe";
import { formatResponse, parseFormat } from "@/lib/api/format-response";
import { TickerReturnsRequestSchema } from "@/lib/api/schemas";
import {
  getDataLicenseMode,
  isRestrictedSourceSymbol,
  RESTRICTED_SOURCE_NOTE,
} from "@/lib/data-license";
import {
  isShareClassSibling,
  resolutionDisclosure,
  resolutionDisclosureHeaders,
} from "@/lib/dal/resolution-disclosure";

export const runtime = "nodejs";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
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

    const symbolRecord = await resolveSymbolByTicker(ticker, { disclosing: true });
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

    // GATE 2 (data-license): CRSP-sourced symbols are derived-only — no raw
    // return/price series for any caller. GATE 1 license_free mode withholds
    // raw EODHD close for everyone; returns_gross stays (Derived Data under
    // Exhibit B) except for CRSP symbols, where the return path IS the
    // licensed series.
    // Exhibit B(e)(1) also withholds the close series from the published shared
    // demo key — a credential lifted from a public text file is not an
    // authenticated environment. returns_gross is Derived and still serves.
    const restrictedSource = isRestrictedSourceSymbol(symbolRecord.symbol);
    const serveReturns = !restrictedSource;
    // ERM3-88: a share-class sibling answer (GOOGL served from GOOG) carries
    // the sibling's returns and hedges, never its close as the requested
    // class's price — price_close is withheld (resolutionDisclosure sets
    // price_withheld).
    const servePrice =
      !restrictedSource &&
      !isShareClassSibling(symbolRecord) &&
      getDataLicenseMode() !== "license_free" &&
      context.rawFieldsPermitted;

    // ETFs live in ds_etf.zarr and have no L1/L2/L3 decomposition. Only request
    // daily-role keys for them — the hedge/returns zarr stores don't carry ETF
    // rows and asking skips a pointless open. Stocks still get the full pull.
    const isEtf = symbolRecord.asset_type === "etf";
    const rawKeys: V3MetricKey[] = [
      ...(serveReturns ? (["returns_gross"] as V3MetricKey[]) : []),
      ...(servePrice ? (["price_close"] as V3MetricKey[]) : []),
    ];
    const keys: V3MetricKey[] = isEtf
      ? rawKeys
      : [
          ...rawKeys,
          "l1_cfr",
          "l2_cfr",
          "l3_cfr",
          "l1_mkt_hr",
          "l1_mkt_er",
          "l1_res_er",
          "l2_mkt_hr",
          "l2_sec_hr",
          "l2_mkt_er",
          "l2_sec_er",
          "l2_res_er",
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
    let historyStarts: Awaited<ReturnType<typeof fetchHistoryWithSource>>["historyStarts"] = {};
    try {
      ({ rows, dataSource, historyStarts } = await fetchHistoryWithSource(
        symbolRecord.symbol,
        keys,
        {
          periodicity: "daily",
          startDate: startDateStr,
          orderBy: "asc",
        },
      ));
    } catch (error) {
      console.error("[ticker-returns] history fetch failed", {
        ticker,
        symbol: symbolRecord.symbol,
        error: "Internal server error",
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
      const base: Record<string, string | number | null> = { date: row.teo };
      // Withheld raw fields are omitted entirely (not nulled) so they also
      // drop out of the CSV/parquet schema and SDK DataFrames.
      if (serveReturns) base.returns_gross = row.returns_gross ?? null;
      if (servePrice) base.price_close = row.price_close ?? null;
      if (isEtf) return base;
      base.l1_cfr = row.l1_cfr ?? null;
      base.l2_cfr = row.l2_cfr ?? null;
      base.l3_cfr = row.l3_cfr ?? null;
      base.l1_mkt_hr = row.l1_mkt_hr ?? null;
      base.l1_mkt_er = row.l1_mkt_er ?? null;
      base.l1_res_er = row.l1_res_er ?? null;
      base.l2_mkt_hr = row.l2_mkt_hr ?? null;
      base.l2_sec_hr = row.l2_sec_hr ?? null;
      base.l2_mkt_er = row.l2_mkt_er ?? null;
      base.l2_sec_er = row.l2_sec_er ?? null;
      base.l2_res_er = row.l2_res_er ?? null;
      base.l3_mkt_hr = row.l3_mkt_hr ?? null;
      base.l3_sec_hr = row.l3_sec_hr ?? null;
      base.l3_sub_hr = row.l3_sub_hr ?? null;
      base.l3_mkt_er = row.l3_mkt_er ?? null;
      base.l3_sec_er = row.l3_sec_er ?? null;
      base.l3_sub_er = row.l3_sub_er ?? null;
      base.l3_res_er = row.l3_res_er ?? null;
      return base;
    });
    const historyStart = historyStarts[symbolRecord.symbol];

    // No billing for empty responses (RMAPI-14): zero rows cost nothing, and
    // the warning names the reason instead of asking the caller to retry.
    let emptyWarning: { data_warning: string; data_warning_code: string; see?: string } | null = null;
    if (data.length === 0) {
      context.setBillableItemCount?.(0);
      if (isEtf) {
        const code = await classifyEmptyEtfReturns(symbolRecord.ticker || ticker);
        const t = (symbolRecord.ticker || ticker).toUpperCase();
        emptyWarning = {
          data_warning_code: code,
          data_warning:
            code === ETF_REASON_CODES.outside_priced
              ? `${t} is outside the priced ETF universe: the API has no daily return series for it. See /api/data/etf/${t} for what is available. Not billed.`
              : `${t} is in the priced ETF universe but has no daily returns in the requested window (${startDateStr} to latest). See /api/data/etf/${t} for priced_from. Not billed.`,
          see: `/api/data/etf/${t}`,
        };
      } else {
        emptyWarning = {
          data_warning_code: "no_return_history_in_window",
          data_warning: `No return history for this symbol in the requested window (${startDateStr} to latest). Not billed.`,
        };
      }
    }

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
        ...(data.length === 0 && historyStart
          ? { "X-History-Starts": historyStart }
          : {}),
        // csv / parquet carry no JSON envelope, so the most-recent-holder
        // disclosure also rides on headers.
        ...resolutionDisclosureHeaders(symbolRecord),
      } as Record<string, string>,
      jsonPayload: {
        symbol: symbolRecord.symbol,
        ticker: symbolRecord.ticker,
        asset_type: symbolRecord.asset_type,
        // Present only when no live registry row carries the ticker and the
        // series belongs to the security that holds it outside the modelled
        // universe or held it most recently (lib/dal/ticker-holder).
        ...resolutionDisclosure(symbolRecord),
        periodicity: "daily",
        data,
        ...(data.length === 0 && historyStart
          ? { history_starts: historyStart }
          : {}),
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
          history_row_count: data.length,
          ...(emptyWarning ?? {}),
          ...(restrictedSource ? RESTRICTED_SOURCE_NOTE : {}),
        }),
        _agent: buildAgentBody({
          request_id: context.requestId,
          cost_usd: context.costUsd,
        }),
      },
    });
    addMetadataHeaders(response, metadata);
    return response;
  },
  // itemCount: 1 exposes setBillableItemCount so an empty response settles at $0.
  { capabilityId: "ticker-returns", itemCount: 1 },
);
