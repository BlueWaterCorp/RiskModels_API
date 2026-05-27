import {
  getLstarService,
  type LstarResult,
} from "@/lib/risk/lstar-service";

export type BatchLstarTickerStatus = "success" | "error" | "not_found";

export interface BatchLstarTickerResult {
  ticker: string;
  status: BatchLstarTickerStatus;
  error?: string;
  dates?: string[];
  lstar?: LstarResult["lstar"];
  market_hr?: LstarResult["market_hr"];
  sector_hr?: LstarResult["sector_hr"];
  subsector_hr?: LstarResult["subsector_hr"];
  total_er?: LstarResult["total_er"];
  residual_return?: LstarResult["residual_return"];
  l2_sector_er?: LstarResult["l2_sector_er"];
  l3_subsector_er?: LstarResult["l3_subsector_er"];
  threshold_used?: number;
  market_factor_etf?: string;
  universe?: string;
  data_source?: string;
}

export interface BatchLstarSummary {
  total: number;
  success: number;
  errors: number;
  not_found: number;
}

export interface BatchLstarResponseBody {
  results: Record<string, BatchLstarTickerResult>;
  summary: BatchLstarSummary;
  years: number;
  threshold_used: number;
  market_factor_etf: string;
}

export interface BatchLstarOptions {
  tickers: string[];
  marketFactorEtf?: string;
  years?: number;
  threshold?: number;
}

function successPayload(result: LstarResult): BatchLstarTickerResult {
  return {
    ticker: result.ticker,
    status: "success",
    dates: result.dates,
    lstar: result.lstar,
    market_hr: result.market_hr,
    sector_hr: result.sector_hr,
    subsector_hr: result.subsector_hr,
    total_er: result.total_er,
    residual_return: result.residual_return,
    l2_sector_er: result.l2_sector_er,
    l3_subsector_er: result.l3_subsector_er,
    threshold_used: result.threshold_used,
    market_factor_etf: result.market_factor_etf,
    universe: result.universe,
    data_source: result.data_source,
  };
}

export async function fetchBatchLstar(
  options: BatchLstarOptions,
): Promise<BatchLstarResponseBody> {
  const service = getLstarService();
  const marketFactorEtf = options.marketFactorEtf ?? "SPY";
  const years = options.years ?? 1;
  const threshold = options.threshold;

  const settled = await Promise.all(
    options.tickers.map(async (rawTicker) => {
      const ticker = rawTicker.toUpperCase();
      try {
        const result = await service.getLstar(ticker, marketFactorEtf, {
          years,
          threshold,
        });
        if (!result) {
          return {
            ticker,
            status: "not_found" as const,
          };
        }
        return successPayload(result);
      } catch (error) {
        return {
          ticker,
          status: "error" as const,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
  );

  const results = Object.fromEntries(
    settled.map((entry) => [entry.ticker, entry]),
  );

  const success = settled.filter((r) => r.status === "success").length;
  const errors = settled.filter((r) => r.status === "error").length;
  const notFound = settled.filter((r) => r.status === "not_found").length;

  const thresholdUsed =
    settled.find((r) => r.status === "success" && r.threshold_used != null)
      ?.threshold_used ??
    threshold ??
    0.01;

  return {
    results,
    summary: {
      total: options.tickers.length,
      success,
      errors,
      not_found: notFound,
    },
    years,
    threshold_used: thresholdUsed,
    market_factor_etf: marketFactorEtf,
  };
}

export function batchLstarToLongRows(
  body: BatchLstarResponseBody,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const entry of Object.values(body.results)) {
    if (entry.status !== "success" || !entry.dates?.length) continue;
    const n = entry.dates.length;
    for (let i = 0; i < n; i += 1) {
      rows.push({
        ticker: entry.ticker,
        date: entry.dates[i],
        lstar: entry.lstar?.[i] ?? null,
        market_hr: entry.market_hr?.[i] ?? null,
        sector_hr: entry.sector_hr?.[i] ?? null,
        subsector_hr: entry.subsector_hr?.[i] ?? null,
        total_er: entry.total_er?.[i] ?? null,
        residual_return: entry.residual_return?.[i] ?? null,
        l2_sector_er: entry.l2_sector_er?.[i] ?? null,
        l3_subsector_er: entry.l3_subsector_er?.[i] ?? null,
      });
    }
  }
  return rows;
}
