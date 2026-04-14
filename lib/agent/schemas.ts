/**
 * JSON Schema definitions for API responses
 *
 * These schemas define the structure of API responses for validation
 * and documentation purposes. They are referenced in the capabilities manifest.
 */

export const TickerReturnsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Ticker Returns Response',
  type: 'object',
  required: ['meta', 'data'],
  properties: {
    meta: {
      type: 'object',
      required: ['market_etf', 'sector_etf', 'subsector_etf'],
      properties: {
        market_etf: { type: 'string', description: 'Market ETF ticker (e.g., SPY)' },
        sector_etf: { type: 'string', description: 'Sector ETF ticker (e.g., XLK)' },
        subsector_etf: { type: 'string', description: 'Subsector ETF ticker' },
      },
    },
    data: {
      type: 'array',
      items: {
        type: 'object',
        required: ['date', 'stock', 'l1', 'l2', 'l3'],
        properties: {
          date: { type: 'string', format: 'date', description: 'Date in YYYY-MM-DD format' },
          stock: { type: 'number', description: 'Daily gross return' },
          l1: { type: 'number', description: 'Level 1 (market) hedge ratio' },
          l2: { type: 'number', description: 'Level 2 (market + sector) hedge ratio' },
          l3: { type: 'number', description: 'Level 3 (full multi-factor) hedge ratio' },
        },
      },
    },
    _agent: {
      type: 'object',
      description: 'Agent-specific metadata',
      properties: {
        cost_usd: { type: 'number', description: 'Cost of this request in USD' },
        latency_ms: { type: 'integer', description: 'Response latency in milliseconds' },
        request_id: { type: 'string', description: 'Unique request identifier' },
        confidence: {
          type: 'object',
          properties: {
            overall: { type: 'number', minimum: 0, maximum: 1 },
            factors: {
              type: 'object',
              properties: {
                data_completeness: { type: 'number' },
                data_freshness: { type: 'number' },
                model_accuracy: { type: 'number' },
                historical_coverage: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
};

export const L3DecompositionSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'L3 Risk Decomposition Response',
  type: 'object',
  required: ['ticker', 'market_factor_etf', 'universe', 'dates'],
  properties: {
    ticker: { type: 'string' },
    market_factor_etf: { type: 'string' },
    universe: { type: 'string' },
    dates: {
      type: 'array',
      items: { type: 'string', format: 'date' },
    },
    _agent: {
      type: 'object',
      properties: {
        cost_usd: { type: 'number' },
        latency_ms: { type: 'integer' },
        request_id: { type: 'string' },
      },
    },
  },
};

export const TickersListSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Tickers List Response',
  type: 'object',
  properties: {
    tickers: {
      type: 'array',
      items: { type: 'string' },
    },
    metadata: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sector: { type: 'string' },
          sector_etf: { type: 'string' },
        },
      },
    },
    ticker: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          company_name: { type: 'string' },
          sector: { type: 'string' },
        },
      },
    },
    _agent: {
      type: 'object',
      properties: {
        cost_usd: { type: 'number' },
        latency_ms: { type: 'integer' },
        request_id: { type: 'string' },
      },
    },
  },
};

export const ErrorResponseSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Error Response',
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', description: 'Error message' },
    error_code: { type: 'string', description: 'Machine-readable error code' },
    message: { type: 'string', description: 'Detailed error message' },
    details: { type: 'object', description: 'Additional error details (dev only)' },
    _agent: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['retry', 'top_up', 'upgrade', 'contact_support'] },
        retry_after_seconds: { type: 'integer' },
        top_up_url: { type: 'string' },
        upgrade_url: { type: 'string' },
      },
    },
  },
};

export const HealthStatusSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Health Status Response',
  type: 'object',
  required: ['status', 'timestamp', 'version'],
  properties: {
    status: { type: 'string', enum: ['healthy', 'degraded', 'down'] },
    timestamp: { type: 'string', format: 'date-time' },
    version: { type: 'string' },
    services: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'degraded', 'down'] },
          latency_ms: { type: 'integer' },
          last_update: { type: 'string', format: 'date-time' },
        },
      },
    },
    capabilities: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['available', 'degraded', 'unavailable'] },
          avg_latency_ms_24h: { type: 'integer' },
          success_rate_24h: { type: 'number' },
          current_load: { type: 'number' },
        },
      },
    },
    teo_coverage: {
      type: 'object',
      description:
        'Gross-return coverage at latest returns_gross teo; sparse = session still filling.',
      properties: {
        latest_teo: { type: ['string', 'null'], format: 'date' },
        universe_stock_count: { type: 'integer', minimum: 0 },
        non_null_returns_symbol_count: { type: 'integer', minimum: 0 },
        latest_teo_coverage_pct: { type: ['number', 'null'] },
        latest_session_returns_pending: { type: 'boolean' },
        query_error: { type: 'string' },
      },
    },
  },
};

export const TelemetryMetricsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Telemetry Metrics Response',
  type: 'object',
  required: ['capability', 'period', 'metrics'],
  properties: {
    capability: { type: 'string' },
    period: { type: 'string' },
    metrics: {
      type: 'object',
      properties: {
        requests: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            successful: { type: 'integer' },
            failed: { type: 'integer' },
            success_rate: { type: 'number' },
          },
        },
        latency: {
          type: 'object',
          properties: {
            avg_ms: { type: 'integer' },
            p50_ms: { type: 'integer' },
            p95_ms: { type: 'integer' },
            p99_ms: { type: 'integer' },
            max_ms: { type: 'integer' },
          },
        },
        pricing: {
          type: 'object',
          properties: {
            avg_cost_per_request_usd: { type: 'number' },
            total_revenue_usd: { type: 'number' },
          },
        },
        data_quality: {
          type: 'object',
          properties: {
            freshness_avg_hours: { type: 'number' },
            coverage_percent: { type: 'number' },
            accuracy_score: { type: 'number' },
          },
        },
      },
    },
    uptime: {
      type: 'object',
      properties: {
        overall_percent: { type: 'number' },
        downtime_minutes: { type: 'integer' },
        incidents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date-time' },
              duration_minutes: { type: 'integer' },
              severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

// Schema registry for lookup by path
export const SCHEMA_REGISTRY: Record<string, object> = {
  '/schemas/l3-decomposition-v1.json': L3DecompositionSchema,
  '/schemas/tickers-list-v1.json': TickersListSchema,
  '/schemas/error-v1.json': ErrorResponseSchema,
  '/schemas/health-v1.json': HealthStatusSchema,
  '/schemas/telemetry-v1.json': TelemetryMetricsSchema,
};

/**
 * Get schema by path
 */
export function getSchema(path: string): object | undefined {
  return SCHEMA_REGISTRY[path];
}

/**
 * Get all schema paths
 */
export function getSchemaPaths(): string[] {
  return Object.keys(SCHEMA_REGISTRY);
}
