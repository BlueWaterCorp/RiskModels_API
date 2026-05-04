import {
  normalizeCompareResult,
  normalizeDecomposeResult,
  normalizeHedgePositionResult,
  normalizePortfolioResult,
} from "./normalize.js";
import type {
  ApiCallMetadata,
  FetchLike,
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
