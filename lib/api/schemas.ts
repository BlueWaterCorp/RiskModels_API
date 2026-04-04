import { z } from "zod";
import { DEFAULT_MACRO_FACTORS, normalizeMacroFactorKeys } from "@/lib/risk/macro-factor-keys";

/**
 * Common schema for ticker symbols.
 * Normalizes input: trims whitespace and converts to uppercase.
 */
export const TickerSchema = z
  .string()
  .min(1, "Ticker is required")
  .max(12, "Ticker too long")
  .transform((val) => val.trim().toUpperCase());

/**
 * Common schema for history years.
 * Minimum 1 year, maximum 15 years as per OPENAPI_SPEC.yaml.
 */
export const YearsSchema = z.coerce
  .number()
  .int()
  .min(1, "Minimum history is 1 year")
  .max(15, "Maximum history is 15 years")
  .default(1);

/**
 * Common schema for response formats.
 */
export const ResponseFormatSchema = z
  .enum(["json", "parquet", "csv"])
  .default("json");

/**
 * Schema for GET /api/metrics/[ticker]
 */
export const MetricsRequestSchema = z.object({
  ticker: TickerSchema,
});

/**
 * Schema for GET /api/ticker-returns
 */
export const TickerReturnsRequestSchema = z.object({
  ticker: TickerSchema,
  years: YearsSchema,
  format: ResponseFormatSchema,
});

/**
 * Schema for GET /api/l3-decomposition
 */
export const L3DecompositionRequestSchema = z.object({
  ticker: TickerSchema,
  market_factor_etf: z.string().default("SPY"),
  years: YearsSchema,
});

/**
 * Schema for POST /api/batch/analyze
 */
export const BatchAnalyzeRequestSchema = z.object({
  tickers: z.array(TickerSchema).min(1, "At least one ticker is required").max(100, "Maximum 100 tickers per batch"),
  metrics: z
    .array(
      z.enum(["returns", "l3_decomposition", "hedge_ratios", "full_metrics"])
    )
    .min(1, "At least one metric must be requested"),
  years: YearsSchema,
  format: ResponseFormatSchema,
});

export type MetricsRequest = z.infer<typeof MetricsRequestSchema>;
export type TickerReturnsRequest = z.infer<typeof TickerReturnsRequestSchema>;
export type L3DecompositionRequest = z.infer<typeof L3DecompositionRequestSchema>;
export type BatchAnalyzeRequest = z.infer<typeof BatchAnalyzeRequestSchema>;

/** Events users may subscribe to (outbound webhooks). */
export const WEBHOOK_EVENT_IDS = ["batch.completed"] as const;
export type WebhookEventId = (typeof WEBHOOK_EVENT_IDS)[number];

/**
 * POST /api/webhooks/subscribe — create a webhook subscription.
 */
export const WebhookSubscribePostSchema = z
  .object({
    url: z.string().url().max(2048),
    events: z.array(z.enum(WEBHOOK_EVENT_IDS)).min(1, "At least one event is required"),
    active: z.boolean().optional(),
    secret: z.string().min(24).max(512).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.url.toLowerCase().startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL must use HTTPS",
        path: ["url"],
      });
    }
  });

export type WebhookSubscribePost = z.infer<typeof WebhookSubscribePostSchema>;

/**
 * POST /api/correlation — stock vs macro factor correlations.
 */
export const FactorCorrelationRequestSchema = z.object({
  ticker: z.union([TickerSchema, z.array(TickerSchema).min(1).max(50)]),
  factors: z
    .array(z.string().min(1))
    .optional()
    .transform((arr) => (arr?.length ? normalizeMacroFactorKeys(arr).keys : undefined))
    .refine(
      (keys) => keys === undefined || keys.length > 0,
      {
        message: `No valid macro factors after normalization. Canonical keys: ${DEFAULT_MACRO_FACTORS.join(", ")}`,
      },
    ),
  return_type: z.enum(["gross", "l1", "l2", "l3_residual"]).default("l3_residual"),
  window_days: z.coerce.number().int().min(20).max(2000).default(252),
  method: z.enum(["pearson", "spearman"]).default("pearson"),
});

export type FactorCorrelationRequest = z.infer<typeof FactorCorrelationRequestSchema>;

/**
 * Schema for POST /api/portfolio/risk-index
 *
 * Positions: array of { ticker, weight } where weights are fractional (sum ≈ 1.0)
 * or dollar amounts (will be normalized). May be empty: API returns `status: "syncing"` when
 * holdings are not ready yet (e.g. Plaid initial sync).
 */
export const PortfolioRiskIndexRequestSchema = z.object({
  positions: z
    .array(
      z.object({
        ticker: TickerSchema,
        weight: z.coerce.number().positive("Weight must be positive"),
      })
    )
    .max(100, "Maximum 100 positions"),
  timeSeries: z.boolean().default(false),
  years: YearsSchema,
});

export type PortfolioRiskIndexRequest = z.infer<typeof PortfolioRiskIndexRequestSchema>;

/**
 * POST /api/portfolio/risk-snapshot — bundled portfolio risk report (JSON or PDF).
 */
export const PortfolioRiskSnapshotRequestSchema = z.object({
  positions: z
    .array(
      z.object({
        ticker: TickerSchema,
        weight: z.coerce.number().positive("Weight must be positive"),
      }),
    )
    .min(1, "At least one position is required")
    .max(100, "Maximum 100 positions"),
  title: z.string().max(200).optional(),
  as_of_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "as_of_date must be YYYY-MM-DD")
    .optional(),
  format: z.enum(["pdf", "png", "json"]).default("json"),
});

export type PortfolioRiskSnapshotRequest = z.infer<typeof PortfolioRiskSnapshotRequestSchema>;

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "Message content is required"),
});

/**
 * POST /api/chat — AI risk analyst (OpenAI).
 */
export const ChatPostSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1, "At least one message is required"),
  model: z.string().min(1).optional(),
  response_mode: z.enum(["markdown", "catalog", "hybrid"]).optional(),
  /** Forwarded to OpenAI when the model supports it (default: omit = provider default true). */
  parallel_tool_calls: z.boolean().optional(),
  /** When true, chat tool executor runs tools sequentially instead of Promise.allSettled. */
  execute_tools_sequentially: z.boolean().optional(),
});

export type ChatPostBody = z.infer<typeof ChatPostSchema>;
