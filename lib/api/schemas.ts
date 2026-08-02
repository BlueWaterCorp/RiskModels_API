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
 * Minimum 1 year, maximum 27 years — the v4 deep panel pushes the history floor
 * back to ~2000 (stock_specific from ~2001 after the 252d style-ETF warmup), so a
 * 15y cap from "today" would clip ~11 years of available depth. See OPENAPI_SPEC.yaml
 * and docs/ERM3_STOCK_SPECIFIC_DEEP_PANEL_UPDATE.md §3.
 */
export const YearsSchema = z.coerce
  .number()
  .int()
  .min(1, "Minimum history is 1 year")
  .max(27, "Maximum history is 27 years")
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
 * Schema for GET /api/fundamentals/[ticker]
 *
 * as_of: PIT date — rows are visible iff filed_date <= as_of (default: today).
 * periods: quarterly rows returned, hard-capped at 40 (anti-scrape: this is a
 *   per-symbol, per-call surface — no batch, no bulk export).
 * erp / tax_rate: caller-supplied cost-of-capital parameters; the defaults
 *   (0.05 / 0.21) live only here and in the docs, never in the data.
 */
export const FundamentalsRequestSchema = z.object({
  ticker: TickerSchema,
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "as_of must be YYYY-MM-DD")
    .optional(),
  periods: z.coerce
    .number()
    .int()
    .min(1, "Minimum 1 period")
    .max(40, "Maximum 40 periods")
    .default(8),
  erp: z.coerce
    .number()
    .min(0, "erp must be >= 0")
    .max(0.5, "erp must be <= 0.5")
    .default(0.05),
  tax_rate: z.coerce
    .number()
    .min(0, "tax_rate must be >= 0")
    .max(1, "tax_rate must be <= 1")
    .default(0.21),
  // Treasury CMT tenor backing rf_rate (the store carries a six-tenor strip,
  // rf_3m..rf_30y). Default 10y = the valuation convention; a caller selecting
  // a short tenor should pair a bill-basis ERP or cost of capital is understated.
  rf_tenor: z.enum(["3m", "1y", "2y", "5y", "10y", "30y"]).default("10y"),
  // Sensitivity-grid variant (H.89.6): when true, the response also carries
  // `sensitivity_grid` — cost_of_equity/wacc/economic_profit across
  // erp_grid x rf_tenor_grid for the latest PIT-visible period only. Cheap:
  // the six-tenor rf strip is already read into the pack for the single-row
  // `rf_tenor` lookup, so the grid is pure computation, no extra I/O.
  grid: z.coerce.boolean().default(false),
  erp_grid: z
    .string()
    .transform((s) => s.split(",").map((v) => Number(v.trim())))
    .refine(
      (arr) => arr.length >= 1 && arr.length <= 10 && arr.every((v) => Number.isFinite(v) && v >= 0 && v <= 0.5),
      "erp_grid must be 1-10 comma-separated numbers in [0, 0.5]",
    )
    .optional(),
  rf_tenor_grid: z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()))
    .pipe(z.array(z.enum(["3m", "1y", "2y", "5y", "10y", "30y"])).min(1).max(6))
    .optional(),
});

/**
 * Schema for GET /api/hedge-basket/[ticker]
 *
 * user_segment drives the leverage cap applied to the recommendation. The four
 * accepted values mirror SEGMENT_LEVERAGE_CAPS in lib/dal/hedge-recommendation:
 *   retail (1.5×) | family_office (2.0× default) | ls_equity (3.0×) | stat_arb (5.0×)
 */
export const HedgeBasketRequestSchema = z.object({
  ticker: TickerSchema,
  user_segment: z
    .enum(["retail", "family_office", "ls_equity", "stat_arb"])
    .default("family_office"),
  market_factor_etf: z.string().default("SPY"),
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
 * H.92 (2026-07-06 CEO deprecation): the style axis read `L*_ff_*` zarr vars the
 * H.81 v4 cutover retired, so it had served all-null since 2026-06-24. Style is a
 * diagnostic block in v4, not a hedge axis. Rejecting (not silently defaulting)
 * keeps the breaking param loud.
 */
export const LSTAR_STYLE_AXIS_REMOVED_MESSAGE =
  "axis=style was removed in v4 — style is a diagnostic block (see POST /v4/decompose); the industry cascade is the only hedge axis";

/**
 * Axis for the L* endpoints. `industry` is the only hedge axis; `style` is
 * still recognized by the enum so it can be rejected with the v4 removal
 * message instead of a generic enum error.
 */
export const LstarAxisSchema = z
  .enum(["industry", "style"])
  .default("industry")
  .refine((v) => v !== "style", { message: LSTAR_STYLE_AXIS_REMOVED_MESSAGE })
  .transform((v) => v as "industry");

/**
 * Schema for GET /api/lstar — per-(ticker, date) recommended hedge level.
 * `threshold` is accepted for SDK callers; chat / agentic surfaces should
 * leave it at the 1% default and treat the response as server-authoritative.
 */
export const LstarRequestSchema = z.object({
  ticker: TickerSchema,
  market_factor_etf: z.string().default("SPY"),
  years: YearsSchema,
  axis: LstarAxisSchema,
  // z.coerce.number() turns null → 0; preprocess so omitted query params get .default(0.01).
  threshold: z.preprocess(
    (val) => (val === null || val === "" || val === undefined ? undefined : val),
    z.coerce
      .number()
      .min(0, "threshold must be >= 0")
      .max(0.5, "threshold must be <= 0.5 (50%)")
      .default(0.01),
  ),
});

export type LstarRequest = z.infer<typeof LstarRequestSchema>;

/**
 * Schema for GET /api/returns-decomposition — full L1/L2/L3 return decomposition.
 * `dispatch=lstar` is a sugar alias for `include_lstar=true`.
 */
export const ReturnsDecompositionRequestSchema = z.object({
  ticker: TickerSchema,
  market_factor_etf: z.string().default("SPY"),
  years: YearsSchema,
  include_lstar: z.coerce.boolean().default(false),
  threshold: z.preprocess(
    (val) => (val === null || val === "" || val === undefined ? undefined : val),
    z.coerce
      .number()
      .min(0, "threshold must be >= 0")
      .max(0.5, "threshold must be <= 0.5 (50%)")
      .default(0.01),
  ),
});

export type ReturnsDecompositionRequest = z.infer<
  typeof ReturnsDecompositionRequestSchema
>;

/**
 * Schema for GET /api/industry-panel — industry peer β cross-section.
 */
export const IndustryPanelRequestSchema = z.object({
  market_factor_etf: z.string().default("SPY"),
  teo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "teo must be YYYY-MM-DD")
    .optional(),
  level: z.enum(["market", "sector", "subsector"]).optional(),
  min_peers: z.coerce
    .number()
    .int()
    .min(1, "min_peers must be >= 1")
    .max(500, "min_peers must be <= 500")
    .optional(),
});

export type IndustryPanelRequest = z.infer<typeof IndustryPanelRequestSchema>;

const RankingMetricSchema = z.enum([
  "mkt_cap",
  "gross_return",
  "sector_residual",
  "subsector_residual",
  "er_l1",
  "er_l2",
  "er_l3",
]);

const RankingCohortSchema = z.enum(["universe", "sector", "subsector"]);

const RankingWindowSchema = z.enum(["1d", "21d", "63d", "252d"]);

/**
 * Schema for POST /api/rankings/screen — full cross-section rank filter.
 */
export const RankingsScreenRequestSchema = z.object({
  metric: RankingMetricSchema,
  cohort: RankingCohortSchema,
  window: RankingWindowSchema,
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "as_of must be YYYY-MM-DD")
    .optional(),
  min_percentile: z.coerce
    .number()
    .min(0, "min_percentile must be >= 0")
    .max(100, "min_percentile must be <= 100")
    .optional(),
  decile: z.coerce
    .number()
    .int()
    .min(1, "decile must be between 1 and 10")
    .max(10, "decile must be between 1 and 10")
    .optional(),
  sector_filter: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be >= 1")
    .max(500, "limit must be <= 500")
    .default(100),
});

export type RankingsScreenRequest = z.infer<typeof RankingsScreenRequestSchema>;

/**
 * Schema for GET /api/residual-signal/[ticker] — Phase D residual
 * mean-reversion factor. `days` is a calendar-day lookback for the history
 * window.
 */
export const ResidualSignalTickerRequestSchema = z.object({
  ticker: TickerSchema,
  days: z.coerce
    .number()
    .int()
    .min(1, "days must be >= 1")
    .max(730, "days must be <= 730")
    .default(90),
});

export type ResidualSignalTickerRequest = z.infer<
  typeof ResidualSignalTickerRequestSchema
>;

/**
 * Schema for GET /api/residual-signal/latest — paginated universe snapshot.
 */
export const ResidualSignalLatestRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ResidualSignalLatestRequest = z.infer<
  typeof ResidualSignalLatestRequestSchema
>;

/**
 * Schema for POST /api/signals/residual-reversion/basket — user-supplied ticker
 * list aggregated to a single residual-reversion signal. Equal-weight default;
 * optional `weights` array aligned to `tickers`; optional signal-quality gate.
 * Trust contract: tickers not in ds_erm3_residual_signal are silently dropped
 * (the upstream mask is the source of truth for "good" rows). The response's
 * `coverage` block carries the requested-vs-contributed count so callers see
 * what landed in the aggregate.
 */
export const ResidualSignalBasketRequestSchema = z
  .object({
    tickers: z
      .array(TickerSchema)
      .min(1, "At least one ticker is required")
      .max(500, "Maximum 500 tickers per basket"),
    weights: z.array(z.number().nonnegative()).optional(),
    signal_quality_min_quintile: z.coerce
      .number()
      .int()
      .min(1, "signal_quality_min_quintile must be 1–5")
      .max(5, "signal_quality_min_quintile must be 1–5")
      .optional(),
  })
  .refine(
    (val) => !val.weights || val.weights.length === val.tickers.length,
    {
      message:
        "weights must align 1:1 with tickers (same length) or be omitted for equal weights",
      path: ["weights"],
    },
  );

export type ResidualSignalBasketRequest = z.infer<
  typeof ResidualSignalBasketRequestSchema
>;

/**
 * Known universe labels — mirror of ERM3 erm3.partitions.KNOWN_UNIVERSES.
 * Keep in sync with the upstream tuple when new universes are added.
 */
const KNOWN_UNIVERSE_LABELS = [
  "uni_mc_50",
  "uni_mc_500",
  "uni_mc_1000",
  "uni_mc_3000",
  "uni_dv_50",
  "uni_dv_500",
  "uni_dv_1000",
  "uni_dv_3000",
] as const;

export const KNOWN_UNIVERSE_LABEL_SET = new Set<string>(KNOWN_UNIVERSE_LABELS);

const UniverseLabelSchema = z.enum(KNOWN_UNIVERSE_LABELS);

/**
 * Schema for GET /api/universe/{name}/members — active universe membership at
 * one teo. Default teo is "latest"; the path param is the universe label and
 * must match the KNOWN_UNIVERSES registry.
 */
export const UniverseMembersRequestSchema = z.object({
  name: UniverseLabelSchema,
  teo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "teo must be YYYY-MM-DD")
    .optional(),
});

export type UniverseMembersRequest = z.infer<typeof UniverseMembersRequestSchema>;

/**
 * Schema for GET /api/etf/factor-returns — one-teo snapshot of close +
 * trailing-window returns for the public-scope factor ETFs (SPY + 11 GICS
 * sector SPDRs). Optional `sleeve` ("market" | "sector" | "all") narrows the
 * panel; optional `tickers` further narrows to a subset within the scope.
 * Unknown tickers fail validation here (never silently coerced) so callers
 * can't probe for the existence of ETFs outside the public-scope registry.
 */
export const EtfFactorReturnsRequestSchema = z.object({
  sleeve: z.enum(["market", "sector", "all"]).default("all"),
  tickers: z
    .string()
    .optional()
    .transform((s) => {
      if (!s) return undefined;
      return s
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
    }),
  teo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "teo must be YYYY-MM-DD")
    .optional(),
});

export type EtfFactorReturnsRequest = z.infer<typeof EtfFactorReturnsRequestSchema>;

/**
 * Schema for POST /api/decompose — simplified four-layer exposure + hedge map.
 * Returns market / sector / subsector / residual with each tradable layer's
 * hedge ETF and a `hedge` map of ETF → dollar ratio (negative of HR by convention).
 *
 * `as_of` (optional) requests a historical read: the latest stored row at or
 * before the date — reality mode, `report_date` basis, echoed back as
 * `as_of_basis` (ADR 2026-08-01). Omitted → the latest-row fast path.
 */
export const DecomposeRequestSchema = z.object({
  ticker: TickerSchema,
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "as_of must be YYYY-MM-DD")
    .optional(),
});

export type DecomposeRequest = z.infer<typeof DecomposeRequestSchema>;

/**
 * POST /api/v4/decompose — canonical named-block decomposition.
 * `basis` selects the explained-variance basis for the style / stock_specific
 * blocks: `L3` (tradeable-hedge basis, default — gives the clean
 * market+industry+style+stock_specific≈1 partition) or `lstar` (adaptive skill
 * basis). Industry hedge layers are always L3; skill metrics are always L*.
 */
export const DecomposeV4RequestSchema = z.object({
  ticker: TickerSchema,
  basis: z.enum(["L3", "lstar"]).default("L3"),
});

export type DecomposeV4Request = z.infer<typeof DecomposeV4RequestSchema>;

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

/**
 * Schema for POST /api/batch/lstar — batch Lstar-dispatched residual return + level.
 */
export const BatchLstarRequestSchema = z.object({
  tickers: z
    .array(TickerSchema)
    .min(1, "At least one ticker is required")
    .max(100, "Maximum 100 tickers per batch"),
  market_factor_etf: z.string().default("SPY"),
  years: YearsSchema,
  axis: LstarAxisSchema,
  threshold: z.preprocess(
    (val) => (val === null || val === "" || val === undefined ? undefined : val),
    z.coerce
      .number()
      .min(0, "threshold must be >= 0")
      .max(0.5, "threshold must be <= 0.5 (50%)")
      .default(0.01),
  ),
  format: ResponseFormatSchema,
});

export type BatchLstarRequest = z.infer<typeof BatchLstarRequestSchema>;

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
  include_diversification: z.boolean().optional().default(false),
  window_days: z.coerce.number().int().min(20).max(2000).optional().default(252),
  no_cache: z.boolean().optional().default(false),
});

export type PortfolioRiskSnapshotRequest = z.infer<typeof PortfolioRiskSnapshotRequestSchema>;

/** One position: exactly one of `weight` (fractional or dollar) or `shares` (for price conversion). */
const SnapshotPortfolioPositionRowSchema = z
  .object({
    ticker: TickerSchema,
    weight: z.coerce.number().positive("weight must be positive").optional(),
    shares: z.coerce.number().positive("shares must be positive").optional(),
  })
  .superRefine((row, ctx) => {
    const hasW = row.weight != null;
    const hasS = row.shares != null;
    if (hasW === hasS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each position must have exactly one of weight or shares",
        path: hasW || hasS ? [] : ["weight"],
      });
    }
  });

/**
 * POST /api/snapshot — canonical JSON snapshot. Per Snapshot Architecture v3,
 * this is the only public analysis interface. Discriminated by `type`:
 *   - "portfolio" → multi-position L3 risk + return attribution
 *   - "ticker"    → single-name L3 decomposition (shim over /metrics + /decompose)
 */
export const SnapshotRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("portfolio"),
      portfolio: z
        .array(SnapshotPortfolioPositionRowSchema)
        .min(1, "At least one position is required")
        .max(100, "Maximum 100 positions"),
      lookback_days: z.coerce.number().int().min(20).max(2000).default(252),
      mode: z.enum(["frozen"]).default("frozen"),
      benchmark: TickerSchema.optional(),
    })
    .superRefine((data, ctx) => {
      const allWeight = data.portfolio.every((p) => p.weight != null);
      const allShares = data.portfolio.every((p) => p.shares != null);
      if (!allWeight && !allShares) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Use weights for every position, or shares for every position (do not mix)",
          path: ["portfolio"],
        });
      }
    }),
  z.object({
    type: z.literal("ticker"),
    ticker: TickerSchema,
    lookback_days: z.coerce.number().int().min(20).max(2000).default(252),
    mode: z.enum(["frozen"]).default("frozen"),
    benchmark: TickerSchema.optional(),
  }),
]);

export type SnapshotRequest = z.infer<typeof SnapshotRequestSchema>;

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
