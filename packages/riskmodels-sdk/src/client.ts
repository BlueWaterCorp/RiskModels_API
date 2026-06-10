import {
  normalizeAnalyzePortfolioResult,
  normalizeCompareResult,
  normalizeDecomposeResult,
  normalizeHedgeLevelsResult,
  normalizeHedgePositionResult,
  normalizeHedgePortfolioResult,
  normalizeHedgeLevel,
  normalizePortfolioResult,
} from "./normalize.js";
import type {
  AnalyzePortfolioOptions,
  ApiCallMetadata,
  FetchLike,
  HedgePortfolioOptions,
  HedgePortfolioPosition,
  HedgePositionInput,
  PositionInput,
  RiskModelsClientOptions,
  RiskModelsResult,
} from "./types.js";
import { runWhitepaperExample } from "./whitepaper.js";

const DEFAULT_BASE_URL = "https://riskmodels.app/api";

interface RequestOptions {
  query?: Record<string, string | number | boolean>;
  body?: unknown;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean>): string {
  const normalizedBase = trimTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function redactedCurl(apiCall: Omit<ApiCallMetadata, "curl">): string {
  const base = trimTrailingSlash(apiCall.base_url);
  const url = new URL(`${base}${apiCall.path}`);
  if (apiCall.query) {
    for (const [key, value] of Object.entries(apiCall.query)) {
      url.searchParams.set(key, String(value));
    }
  }
  const parts = [
    "curl",
    apiCall.method === "POST" ? "-X POST" : "-X GET",
    JSON.stringify(url.toString()),
    "-H \"Authorization: Bearer $RISKMODELS_API_KEY\"",
  ];
  if (apiCall.body !== undefined) {
    parts.push("-H \"Content-Type: application/json\"");
    parts.push(`-d '${JSON.stringify(apiCall.body)}'`);
  }
  return parts.join(" ");
}

/** Wrap a raw GET payload with the request metadata, without a bespoke normalizer. */
function attachApiCall(raw: unknown, apiCall: ApiCallMetadata): Record<string, unknown> {
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : { data: raw };
  return { ...payload, api_call: apiCall };
}

function positionWeight(position: PositionInput): number {
  const value = position.weight ?? position.dollars;
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Position for ${position.ticker} requires a positive weight or dollars value`);
  }
  return value;
}

function envValue(name: string): string | undefined {
  const runtime = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name];
}

export class RiskModelsClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: RiskModelsClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  static fromEnv(options: Omit<RiskModelsClientOptions, "apiKey" | "baseUrl"> = {}): RiskModelsClient {
    return new RiskModelsClient({
      ...options,
      apiKey: envValue("RISKMODELS_API_KEY"),
      baseUrl: envValue("RISKMODELS_API_BASE_URL") ?? DEFAULT_BASE_URL,
    });
  }

  async decompose(ticker: string): Promise<RiskModelsResult> {
    const body = { ticker: ticker.trim().toUpperCase() };
    const { raw, apiCall } = await this.request("POST", "/decompose", { body });
    return normalizeDecomposeResult(raw, apiCall);
  }

  /** GET /metrics/{ticker} narrowed to `hedge_levels` (canonical L1/L2/L3 block). */
  async getHedgeLevels(ticker: string): Promise<RiskModelsResult> {
    const trimmed = ticker.trim().toUpperCase();
    const { raw, apiCall } = await this.request("GET", `/metrics/${trimmed}`);
    return normalizeHedgeLevelsResult(raw, apiCall);
  }

  async compare(tickers: string[]): Promise<RiskModelsResult> {
    const body = {
      tickers: tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean),
      metrics: ["full_metrics", "hedge_ratios"],
      years: 1,
      format: "json",
    };
    if (body.tickers.length < 2) {
      throw new Error("compare requires at least two tickers");
    }
    const { raw, apiCall } = await this.request("POST", "/batch/analyze", { body });
    return normalizeCompareResult(raw, apiCall);
  }

  async hedgePosition(input: HedgePositionInput): Promise<RiskModelsResult> {
    if (!Number.isFinite(input.dollars) || input.dollars <= 0) {
      throw new Error("hedgePosition requires a positive dollars value");
    }
    const body = { ticker: input.ticker.trim().toUpperCase() };
    const { raw, apiCall } = await this.request("POST", "/decompose", { body });
    return normalizeHedgePositionResult(raw, apiCall, input.dollars);
  }

  /**
   * POST /batch/analyze with hedge_ratios and aggregate per-ticker `hedge_levels` into
   * holdings-weighted portfolio L1/L2/L3 snapshots.
   */
  async analyzePortfolio(
    positions: PositionInput[],
    options?: AnalyzePortfolioOptions,
  ): Promise<RiskModelsResult> {
    if (positions.length === 0) {
      throw new Error("analyzePortfolio requires at least one position");
    }
    let denom = 0;
    const accWeights: Record<string, number> = {};
    for (const position of positions) {
      denom += positionWeight(position);
    }
    for (const position of positions) {
      const title = position.ticker.trim().toUpperCase();
      accWeights[title] = (accWeights[title] ?? 0) + positionWeight(position) / denom;
    }
    const tickers = Object.keys(accWeights);
    const body = {
      tickers,
      metrics: ["hedge_ratios"],
      years: options?.years ?? 1,
      format: "json",
    };
    const { raw, apiCall } = await this.request("POST", "/batch/analyze", { body });
    return normalizeAnalyzePortfolioResult(raw, apiCall, accWeights);
  }

  /**
   * Batch-analyze holdings, choose one cascade level, and aggregate scaled ETF hedge notionals
   * (`hr * stock_usd`) across names.
   */
  async hedgePortfolio(
    inputs: HedgePortfolioPosition[],
    options?: HedgePortfolioOptions,
  ): Promise<RiskModelsResult> {
    if (inputs.length === 0) {
      throw new Error("hedgePortfolio requires at least one line");
    }
    const merged: Record<string, number> = {};
    for (const line of inputs) {
      if (!Number.isFinite(line.dollars) || line.dollars <= 0) {
        throw new Error("hedgePortfolio requires positive dollars on every line");
      }
      const key = line.ticker.trim().toUpperCase();
      merged[key] = (merged[key] ?? 0) + line.dollars;
    }
    const tickers = Object.keys(merged);
    const body = {
      tickers,
      metrics: ["hedge_ratios"],
      years: options?.years ?? 1,
      format: "json",
    };
    const { raw, apiCall } = await this.request("POST", "/batch/analyze", { body });
    return normalizeHedgePortfolioResult(raw, apiCall, merged, normalizeHedgeLevel(options?.level));
  }

  async portfolioDecompose(positions: PositionInput[]): Promise<RiskModelsResult> {
    if (positions.length === 0) {
      throw new Error("portfolioDecompose requires at least one position");
    }
    const body = {
      format: "json",
      positions: positions.map((position) => ({
        ticker: position.ticker.trim().toUpperCase(),
        weight: positionWeight(position),
      })),
    };
    const { raw, apiCall } = await this.request("POST", "/portfolio/risk-snapshot", { body });
    return normalizePortfolioResult(raw, apiCall);
  }

  async whitepaperExample(exampleId: Parameters<typeof runWhitepaperExample>[1]) {
    return runWhitepaperExample(this, exampleId);
  }

  /**
   * GET /ticker-returns — daily dividend-adjusted total (gross) return series for a
   * single name, with per-day L3 market/sector/subsector hedge ratios and
   * explained-risk fractions. Up to 15 years of point-in-time history.
   */
  async getReturns(
    ticker: string,
    options: { years?: number; array?: string } = {},
  ): Promise<Record<string, unknown>> {
    const query: Record<string, string | number | boolean> = {
      ticker: ticker.trim().toUpperCase(),
    };
    if (options.years !== undefined) query.years = options.years;
    if (options.array !== undefined) query.array = options.array;
    const { raw, apiCall } = await this.request("GET", "/ticker-returns", { query });
    return attachApiCall(raw, apiCall);
  }

  /**
   * GET /returns-decomposition — daily gross return decomposed into additive
   * L1/L2/L3 factor (market/sector/subsector) and residual return components,
   * isolating residual (stock-specific) return. Optional Lstar dispatch.
   */
  async getReturnAttribution(
    ticker: string,
    options: {
      years?: number;
      marketFactorEtf?: string;
      includeLstar?: boolean;
      threshold?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const query: Record<string, string | number | boolean> = {
      ticker: ticker.trim().toUpperCase(),
    };
    if (options.years !== undefined) query.years = options.years;
    if (options.marketFactorEtf !== undefined) query.market_factor_etf = options.marketFactorEtf;
    if (options.includeLstar !== undefined) query.include_lstar = options.includeLstar;
    if (options.threshold !== undefined) query.threshold = options.threshold;
    const { raw, apiCall } = await this.request("GET", "/returns-decomposition", { query });
    return attachApiCall(raw, apiCall);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions = {},
  ): Promise<{ raw: unknown; apiCall: ApiCallMetadata }> {
    const apiCallBase: Omit<ApiCallMetadata, "curl"> = {
      method,
      path,
      base_url: this.baseUrl,
      ...(options.query ? { query: options.query } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
    };
    const response = await this.fetchImpl(buildUrl(this.baseUrl, path, options.query), {
      method,
      headers: {
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let raw: unknown = null;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = { raw: text };
    }

    if (!response.ok) {
      const message =
        raw && typeof raw === "object" && "message" in raw
          ? String((raw as { message: unknown }).message)
          : `RiskModels API request failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    return {
      raw,
      apiCall: {
        ...apiCallBase,
        curl: redactedCurl(apiCallBase),
        data_as_of: response.headers.get("X-Data-As-Of") ?? undefined,
        request_id: response.headers.get("X-Request-ID") ?? undefined,
        cost_usd: response.headers.get("X-API-Cost-USD")
          ? Number(response.headers.get("X-API-Cost-USD"))
          : undefined,
      },
    };
  }
}
