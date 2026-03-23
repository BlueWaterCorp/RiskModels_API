import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { resolveSymbolByTicker, fetchHistory, pivotHistory } from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { formatResponse } from "@/lib/api/format-response";

function getSupabase() {
  return createAdminClient();
}

interface BatchRequest {
  tickers: string[];
  metrics?: (
    | "returns"
    | "l3_decomposition"
    | "hedge_ratios"
    | "full_metrics"
  )[];
  years?: number;
  format?: "json" | "parquet" | "csv";
}

// Helper: Map FactSet sector codes to representative ETFs
function sectorCodeToETF(sectorCode: string): string {
  const sectorMap: Record<string, string> = {
    "10": "XLK", // Technology
    "15": "XLF", // Financials
    "20": "XLI", // Industrials
    "25": "XLE", // Energy
    "30": "XLU", // Utilities
    "35": "XLP", // Consumer Staples
    "40": "XLY", // Consumer Discretionary
    "45": "XLB", // Materials
    "50": "XLI", // Communication (using Industrials as proxy)
    "55": "XLV", // Health Care
    "60": "XLRE", // Real Estate
  };
  return sectorMap[sectorCode] || "XLK";
}

// Helper: Map FactSet industry codes to representative ETFs
function industryCodeToETF(industryCode: string): string {
  // For now, map to sector ETFs - can be expanded for finer granularity
  const industryMap: Record<string, string> = {
    // Technology industries
    "1010": "XLK", // Software
    "1020": "XLK", // Hardware
    "1030": "XLK", // Semiconductors
    // Financial industries
    "1510": "XLF", // Banks
    "1520": "XLF", // Insurance
    // ... add more as needed
  };
  return industryMap[industryCode] || "XLK";
}

interface PositionAnalysis {
  ticker: string;
  status: "success" | "error";
  error?: string;
  returns?: {
    dates: string[];
    values: number[];
    l1: number[];
    l2: number[];
    l3: number[];
  };
  l3_decomposition?: {
    market_factor_etf: string;
    universe: string;
    dates: string[];
  };
  hedge_ratios?: {
    l1_market: number;
    l2_market: number;
    l2_sector: number;
    l3_market: number;
    l3_sector: number;
    l3_subsector: number;
  };
  full_metrics?: any;
  meta?: {
    market_etf: string;
    sector_etf: string;
    subsector_etf: string;
  };
}

export const dynamic = "force-dynamic";

async function getBatchItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const clone = req.clone();
    const body = (await clone.json()) as BatchRequest;
    return body.tickers?.length;
  } catch {
    return undefined;
  }
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    let body: BatchRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body" },
        { status: 400 },
      );
    }

    const { tickers, metrics = ["returns"], years = 1, format: reqFormat = "json" } = body;

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json(
        {
          error: "Invalid tickers",
          message: "tickers must be a non-empty array",
        },
        { status: 400 },
      );
    }

    const { count, error: countError } = await getSupabase()
      .from("symbols")
      .select("*", { count: "exact", head: true });
    console.log(
      `[Batch/analyze] symbols count: ${count}, error: ${countError?.message || "none"}`,
    );

    const results = await Promise.all(
      tickers.map((ticker) =>
        analyzeTicker(ticker.toUpperCase(), metrics, years, context.requestId),
      ),
    );

    const successCount = results.filter((r) => r.status === "success").length;
    const errorCount = results.filter((r) => r.status === "error").length;
    const metadata = await getRiskMetadata();

    const format =
      reqFormat === "parquet" || reqFormat === "csv" ? reqFormat : "json";

    if (format !== "json") {
      const rows: Record<string, unknown>[] = [];
      for (const r of results) {
        if (r.status === "success" && r.returns) {
          const { dates, values, l1, l2, l3 } = r.returns;
          for (let i = 0; i < (dates?.length ?? 0); i++) {
            rows.push({
              ticker: r.ticker,
              date: dates![i],
              gross_return: values?.[i] ?? null,
              l1: l1?.[i] ?? null,
              l2: l2?.[i] ?? null,
              l3: l3?.[i] ?? null,
            });
          }
        }
      }
      const filename = `batch_returns_${tickers.length}tickers.${format}`;
      const response = await formatResponse({
        rows,
        format,
        filename,
      });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const response = NextResponse.json({
      results: Object.fromEntries(results.map((r) => [r.ticker, r])),
      summary: {
        total: tickers.length,
        success: successCount,
        errors: errorCount,
      },
      _agent: { cost_usd: context.costUsd, request_id: context.requestId },
      _metadata: buildMetadataBody(metadata),
    });
    addMetadataHeaders(response, metadata);
    return response;
  },
  {
    capabilityId: "batch-analysis",
    getItemCount: getBatchItemCount,
  },
);

// Ticker normalization mapping for common variations
const TICKER_NORMALIZATIONS: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK-A": "BRK-A",
  GOOG: "GOOGL", // Class C -> Class A
};

// Generate ticker variations to try
function getTickerVariations(ticker: string): string[] {
  const variations = new Set<string>();
  variations.add(ticker);
  variations.add(ticker.toUpperCase());

  // Add normalized version if exists
  if (TICKER_NORMALIZATIONS[ticker]) {
    variations.add(TICKER_NORMALIZATIONS[ticker]);
  }

  // Handle dot vs dash variations (e.g., BRK.B -> BRK-B)
  if (ticker.includes(".")) {
    variations.add(ticker.replace(".", "-"));
  }
  if (ticker.includes("-")) {
    variations.add(ticker.replace("-", "."));
  }

  // Handle common suffixes
  if (ticker.endsWith(".B")) {
    variations.add(ticker.replace(".B", "-B"));
    variations.add(ticker.replace(".B", "B"));
  }
  if (ticker.endsWith("-B")) {
    variations.add(ticker.replace("-B", ".B"));
    variations.add(ticker.replace("-B", "B"));
  }

  return Array.from(variations);
}

async function analyzeTicker(
  ticker: string,
  metrics: string[],
  years: number,
  requestId: string,
): Promise<PositionAnalysis> {
  const result: PositionAnalysis = { ticker, status: "success" };

  try {
    const variations = getTickerVariations(ticker);
    console.log(
      `[Batch/analyzeTicker] Looking up ${ticker}, trying variations:`,
      variations,
    );

    let symbolRecord: Awaited<ReturnType<typeof resolveSymbolByTicker>> = null;
    let foundVariation: string | null = null;

    // Try each variation with V3 DAL
    for (const variation of variations) {
      const resolved = await resolveSymbolByTicker(variation);
      if (resolved) {
        symbolRecord = resolved;
        foundVariation = variation;
        console.log(
          `[Batch/analyzeTicker] Found ${ticker} using variation ${variation}`,
        );
        break;
      }
    }

    if (!symbolRecord) {
      console.warn(
        `[Batch/analyzeTicker] Symbol not found for ticker ${ticker} (tried: ${variations.join(", ")})`,
      );
      result.status = "error";
      result.error = `Symbol not found for ticker ${ticker}`;
      return result;
    }

    if (foundVariation && foundVariation !== ticker) {
      console.log(
        `[Batch/analyzeTicker] Found ${ticker} using variation ${foundVariation}`,
      );
    }

    console.log(
      `[Batch/analyzeTicker] Found symbol for ${ticker}: ${symbolRecord.symbol}`,
    );

    if (metrics.includes("returns")) {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - years);

      const rows = await fetchHistory(symbolRecord.symbol, [
        "returns_gross",
        "l3_mkt_hr",
        "l3_sec_hr",
        "l3_sub_hr",
      ], {
        periodicity: "daily",
        startDate: startDate.toISOString().split("T")[0],
        orderBy: "asc",
      });

      const pivoted = pivotHistory(rows);

      result.returns = {
        dates: pivoted.map(p => p.teo),
        values: pivoted.map((p) => p.returns_gross as number ?? 0),
        l1: pivoted.map((p) => p.l3_mkt_hr as number ?? 0),
        l2: pivoted.map((p) => p.l3_sec_hr as number ?? 0),
        l3: pivoted.map((p) => p.l3_sub_hr as number ?? 0),
      };

      result.meta = {
        market_etf: "SPY",
        sector_etf: symbolRecord.sector_etf || "XLK",
        subsector_etf: symbolRecord.sector_etf || "XLK",
      };
    }

    if (metrics.includes("hedge_ratios") || metrics.includes("full_metrics")) {
      // Fetch latest metrics from V3 contract
      const latestRows = await fetchHistory(symbolRecord.symbol, [
        "vol_23d",
        "price_close",
        "market_cap",
        "l3_mkt_hr",
        "l3_sec_hr",
        "l3_sub_hr",
        "l3_mkt_er",
        "l3_sec_er",
        "l3_sub_er",
        "l3_res_er"
      ], {
        periodicity: "daily",
        orderBy: "desc",
      });

      const latestPivoted = pivotHistory(latestRows);
      const latest = latestPivoted[0] || {};

      if (metrics.includes("hedge_ratios")) {
        result.hedge_ratios = {
          l1_market: latest.l3_mkt_hr as number ?? null,
          l2_market: latest.l3_mkt_hr as number ?? null,
          l2_sector: latest.l3_sec_hr as number ?? null,
          l3_market: latest.l3_mkt_hr as number ?? null,
          l3_sector: latest.l3_sec_hr as number ?? null,
          l3_subsector: latest.l3_sub_hr as number ?? null,
        };
      }
      if (metrics.includes("full_metrics")) {
        result.full_metrics = {
          ticker: symbolRecord.ticker,
          date: latest.teo,
          volatility: latest.vol_23d as number ?? null,
          l3_mkt_hr: latest.l3_mkt_hr as number ?? null,
          l3_sec_hr: latest.l3_sec_hr as number ?? null,
          l3_sub_hr: latest.l3_sub_hr as number ?? null,
          l3_mkt_er: latest.l3_mkt_er as number ?? null,
          l3_sec_er: latest.l3_sec_er as number ?? null,
          l3_sub_er: latest.l3_sub_er as number ?? null,
          l3_res_er: latest.l3_res_er as number ?? null,
          market_cap: latest.market_cap as number ?? null,
          close_price: latest.price_close as number ?? null,
        };
      }
    }
  } catch (error) {
    console.error(`[Batch/analyzeTicker] Error for ${ticker}:`, error);
    result.status = "error";
    result.error = error instanceof Error ? error.message : "Unknown error";
  }
  return result;
}
