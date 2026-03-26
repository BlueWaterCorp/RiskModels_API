import { z } from "zod";

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
