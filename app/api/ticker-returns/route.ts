import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireAuth,
  checkBalance,
  deductBalance,
  generateRequestId,
} from "@/lib/api-auth";
import {
  createApiResponse,
  createErrorResponse,
  PRICING,
} from "@/lib/api-response";
import { resolveTickerAlias } from "@/lib/ticker-aliases";

export const dynamic = "force-dynamic";

const COST_USD = PRICING.TICKER_RETURNS; // $0.005
const MAX_YEARS = 15;

// Metric keys to fetch from security_history (V3 format per TickerReturnsDailyRow)
const METRIC_KEYS = [
  "returns_gross",
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
];

interface SecurityHistoryRow {
  symbol: string;
  teo: string;
  metric_key: string;
  metric_value: number | null;
}

interface DailyRow {
  date: string;
  returns_gross: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
  l3_mkt_er: number | null;
  l3_sec_er: number | null;
  l3_sub_er: number | null;
  l3_res_er: number | null;
}

/**
 * GET /api/ticker-returns
 *
 * Returns daily returns time series with rolling hedge ratios.
 *
 * Query params:
 *   - ticker (required): Ticker symbol
 *   - years (optional): Years of history (1-15, default: 1)
 *   - limit (optional): Maximum number of rows to return
 *   - format (optional): Response format (json|csv|parquet, default: json)
 *
 * Authentication: Bearer token required
 * Cost: $0.005 per call
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // 1. Authenticate
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }
  const { userId, keyId } = authResult;

  // 2. Parse query params
  const sp = request.nextUrl.searchParams;
  const tickerParam = sp.get("ticker");
  const yearsParam = sp.get("years");
  const limitParam = sp.get("limit");
  const formatParam = sp.get("format") ?? "json";

  if (!tickerParam) {
    return createErrorResponse(
      "MISSING_PARAMETER",
      "ticker query parameter is required",
      400,
      undefined,
      requestId,
    );
  }

  const ticker = resolveTickerAlias(tickerParam);
  const years = Math.min(
    Math.max(1, Number(yearsParam) || 1),
    MAX_YEARS,
  );
  const limit = limitParam ? Number(limitParam) : undefined;

  // Validate format
  const format = formatParam.toLowerCase();
  if (!["json", "csv", "parquet"].includes(format)) {
    return createErrorResponse(
      "INVALID_FORMAT",
      "format must be one of: json, csv, parquet",
      400,
      undefined,
      requestId,
    );
  }

  // 3. Check balance
  const { hasBalance, currentBalance } = await checkBalance(userId, COST_USD);
  if (!hasBalance) {
    return createErrorResponse(
      "INSUFFICIENT_BALANCE",
      `Insufficient balance. Current: $${currentBalance.toFixed(2)}, Required: $${COST_USD}`,
      402,
      { current_balance: currentBalance, required: COST_USD },
      requestId,
    );
  }

  const supabase = createAdminClient();

  // 4. Resolve ticker to symbol and get metadata
  const { data: symbolData, error: symbolError } = await supabase
    .from("symbols")
    .select("symbol, ticker, sector_etf, subsector_etf, metadata")
    .eq("ticker", ticker)
    .maybeSingle();

  if (symbolError) {
    console.error(`[ticker-returns] Error resolving ${ticker}:`, symbolError);
    return createErrorResponse(
      "INTERNAL_ERROR",
      "Failed to resolve ticker",
      500,
      undefined,
      requestId,
    );
  }

  if (!symbolData) {
    return createErrorResponse(
      "TICKER_NOT_FOUND",
      `Ticker '${tickerParam}' not found in universe`,
      404,
      { ticker: tickerParam },
      requestId,
    );
  }

  const symbol = symbolData.symbol;
  const metadata = (symbolData.metadata as Record<string, unknown>) ?? {};

  // Determine market ETF (typically SPY for US equities)
  const marketEtf = "SPY";
  const sectorEtf = symbolData.sector_etf ??
    (metadata.sector_etf as string | null) ??
    null;
  const subsectorEtf = symbolData.subsector_etf ??
    (metadata.subsector_etf as string | null) ??
    null;

  // 5. Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - years);
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  // 6. Query security_history for time series data
  let query = supabase
    .from("security_history")
    .select("symbol, teo, metric_key, metric_value")
    .eq("symbol", symbol)
    .eq("periodicity", "daily")
    .in("metric_key", METRIC_KEYS)
    .gte("teo", startDateStr)
    .lte("teo", endDateStr)
    .order("teo", { ascending: true });

  if (limit && limit > 0) {
    query = query.limit(limit);
  }

  const { data: historyData, error: historyError } = await query;

  if (historyError) {
    console.error(`[ticker-returns] Error fetching history for ${symbol}:`, historyError);
    return createErrorResponse(
      "INTERNAL_ERROR",
      "Failed to fetch time series data",
      500,
      undefined,
      requestId,
    );
  }

  // 7. Pivot EAV data to row format
  const rowsByDate = new Map<string, Partial<DailyRow>>();

  for (const row of (historyData ?? []) as SecurityHistoryRow[]) {
    const date = row.teo;
    if (!rowsByDate.has(date)) {
      rowsByDate.set(date, { date });
    }
    const dayRow = rowsByDate.get(date)!;

    switch (row.metric_key) {
      case "returns_gross":
        dayRow.returns_gross = row.metric_value;
        break;
      case "l3_mkt_hr":
        dayRow.l3_mkt_hr = row.metric_value;
        break;
      case "l3_sec_hr":
        dayRow.l3_sec_hr = row.metric_value;
        break;
      case "l3_sub_hr":
        dayRow.l3_sub_hr = row.metric_value;
        break;
      case "l3_mkt_er":
        dayRow.l3_mkt_er = row.metric_value;
        break;
      case "l3_sec_er":
        dayRow.l3_sec_er = row.metric_value;
        break;
      case "l3_sub_er":
        dayRow.l3_sub_er = row.metric_value;
        break;
      case "l3_res_er":
        dayRow.l3_res_er = row.metric_value;
        break;
    }
  }

  // Convert to sorted array
  const sortedDates = Array.from(rowsByDate.keys()).sort();
  const dataRows: DailyRow[] = sortedDates.map((date) => {
    const row = rowsByDate.get(date)!;
    return {
      date,
      returns_gross: row.returns_gross ?? null,
      l3_mkt_hr: row.l3_mkt_hr ?? null,
      l3_sec_hr: row.l3_sec_hr ?? null,
      l3_sub_hr: row.l3_sub_hr ?? null,
      l3_mkt_er: row.l3_mkt_er ?? null,
      l3_sec_er: row.l3_sec_er ?? null,
      l3_sub_er: row.l3_sub_er ?? null,
      l3_res_er: row.l3_res_er ?? null,
    };
  });

  // 8. Deduct balance
  await deductBalance(userId, keyId, COST_USD, "ticker_returns_v3", requestId);

  // 9. Format response based on requested format
  const latencyMs = Date.now() - startTime;

  if (format === "csv") {
    const headers = [
      "date",
      "returns_gross",
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l3_mkt_er",
      "l3_sec_er",
      "l3_sub_er",
      "l3_res_er",
    ];
    const csvLines = [
      headers.join(","),
      ...dataRows.map((row) =>
        headers.map((h) => {
          const val = row[h as keyof DailyRow];
          return val === null || val === undefined ? "" : String(val);
        }).join(",")
      ),
    ];
    const csvBody = csvLines.join("\n");

    return new NextResponse(csvBody, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${ticker}_returns.csv"`,
        "X-Request-ID": requestId,
        "X-API-Cost-USD": String(COST_USD),
        "X-Response-Latency-Ms": String(latencyMs),
      },
    });
  }

  if (format === "parquet") {
    // For parquet, we return JSON with a note that parquet requires additional implementation
    // In production, this would use a parquet library to encode the data
    return createApiResponse(
      {
        symbol,
        ticker: symbolData.ticker,
        periodicity: "daily",
        data: dataRows,
        meta: {
          market_etf: marketEtf,
          sector_etf: sectorEtf,
          subsector_etf: subsectorEtf,
          universe: "US_EQUITY",
        },
        _note: "Parquet format requires server-side encoding. Use ?format=json or ?format=csv for now.",
      },
      {
        costUsd: COST_USD,
        requestId,
        latencyMs,
        billingCode: "ticker_returns_v3",
      },
    );
  }

  // JSON format (default)
  return createApiResponse(
    {
      symbol,
      ticker: symbolData.ticker,
      periodicity: "daily",
      data: dataRows,
      meta: {
        market_etf: marketEtf,
        sector_etf: sectorEtf,
        subsector_etf: subsectorEtf,
        universe: "US_EQUITY",
      },
    },
    {
      costUsd: COST_USD,
      requestId,
      latencyMs,
      billingCode: "ticker_returns_v3",
    },
  );
}
