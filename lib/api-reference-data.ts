/**
 * API Reference endpoint data derived from OPENAPI_SPEC.yaml.
 * Grouped by tag for sidebar navigation.
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export interface EndpointParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

export interface Endpoint {
  path: string;
  method: HttpMethod;
  sidebarLabel?: string;
  summary: string;
  description: string;
  operationId: string;
  tag: string;
  params: EndpointParam[];
  requestBody?: { contentType: string; example?: string };
  responses: { status: number; description: string }[];
}

export interface EndpointGroup {
  name: string;
  description?: string;
  endpoints: Endpoint[];
}

export const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    name: 'Risk Metrics',
    description: 'ERM3 factor hedge ratios, explained risk, and return decompositions.',
    endpoints: [
      {
        path: '/metrics/{ticker}',
        method: 'get',
        summary: 'Latest risk metrics snapshot',
        description:
          'Returns the most recent row from security_history_latest for the given ticker. Includes all 6 hedge ratios (HR), 7 explained-risk fractions (ER), volatility, Sharpe ratio, sector codes, market cap, and close price. Cost: $0.005/request.',
        operationId: 'getMetrics',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'path', type: 'string', required: true, description: 'Ticker symbol (case-insensitive).' },
        ],
        responses: [
          { status: 200, description: 'Latest metrics snapshot.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 402, description: 'Insufficient balance.' },
          { status: 404, description: 'Ticker not found in universe.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/ticker-returns',
        method: 'get',
        summary: 'Daily returns time series with rolling hedge ratios',
        description:
          'Returns a daily time series of gross stock returns and rolling L1/L2/L3 combined hedge ratios going back up to 15 years. Cost: $0.005/call regardless of years pulled.',
        operationId: 'getTickerReturns',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'years', in: 'query', type: 'integer', required: false, description: 'Years of history (1–15).', default: '1' },
          { name: 'format', in: 'query', type: 'string', required: false, description: 'json (default), parquet (Content-Type application/vnd.apache.parquet), or csv (text/csv; charset=utf-8). Tabular formats omit _metadata in body; use X-Risk-* headers.', default: 'json' },
        ],
        responses: [
          { status: 200, description: 'Time series of daily returns and rolling hedge ratios.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Ticker not found.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/returns',
        method: 'get',
        summary: 'Daily gross returns time series',
        description: 'Returns daily gross returns for a single stock. Simpler than /ticker-returns (no hedge ratios). Cost: $0.005/call.',
        operationId: 'getReturns',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'format', in: 'query', type: 'string', required: false, description: 'json, parquet, or csv; see OPENAPI_SPEC tabular export section.', default: 'json' },
        ],
        responses: [
          { status: 200, description: 'Daily returns.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/l3-decomposition',
        method: 'get',
        summary: 'L3 explained-risk decomposition',
        description:
          'Returns L3 variance decomposition (market, sector, subsector, residual) for a ticker over a date range. Cost: $0.005/call.',
        operationId: 'getL3Decomposition',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'years', in: 'query', type: 'integer', required: false, description: 'Years of history.', default: '1' },
          { name: 'format', in: 'query', type: 'string', required: false, description: 'json, parquet, or csv; see OPENAPI_SPEC tabular export section.', default: 'json' },
        ],
        responses: [
          { status: 200, description: 'L3 decomposition data.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/batch/analyze',
        method: 'post',
        summary: 'Multi-ticker batch analysis (25% discount)',
        description:
          'Fetch metrics for up to 100 tickers in a single call. 25% cheaper per position than individual /metrics/{ticker} calls. Cost: $0.002/position, minimum $0.01/call.',
        operationId: 'batchAnalyze',
        tag: 'Risk Metrics',
        params: [
          { name: 'tickers', in: 'body', type: 'array', required: true, description: 'List of ticker symbols (max 100).' },
          { name: 'metrics', in: 'body', type: 'array', required: true, description: 'Whitelist: returns, hedge_ratios (6 HR short keys), full_metrics (L1/L2/L3 ER/HR flat keys). See docs/ERM3_ZARR_API_PARITY.md for zarr L*_ER/L*_HR mapping.' },
          { name: 'years', in: 'body', type: 'integer', required: false, description: 'Years of history.', default: '1' },
        ],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            { tickers: ['AAPL', 'MSFT', 'NVDA'], metrics: ['hedge_ratios'], years: 1 },
            null,
            2
          ),
        },
        responses: [
          { status: 200, description: 'Batch results keyed by ticker.' },
          { status: 400, description: 'Invalid request or too many tickers.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/chat',
        method: 'post',
        summary: 'AI Risk Analyst',
        description: 'Natural language risk analysis via conversational AI (GPT-4). Billed per token.',
        operationId: 'postChat',
        tag: 'Risk Metrics',
        params: [{ name: 'messages', in: 'body', type: 'array', required: true, description: 'Conversation messages.' }],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            { messages: [{ role: 'user', content: 'What is NVDA exposure to tech sector?' }], model: 'gpt-4o-mini' },
            null,
            2
          ),
        },
        responses: [
          { status: 200, description: 'Assistant reply and optional tool calls.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
    ],
  },
  {
    name: 'Utility',
    description: 'Ticker search, health, and service discovery.',
    endpoints: [
      {
        path: '/tickers',
        method: 'get',
        summary: 'Ticker universe search',
        description: 'List tickers in the universe or search by name/symbol. Free endpoint (no charge).',
        operationId: 'getTickers',
        tag: 'Utility',
        params: [
          { name: 'search', in: 'query', type: 'string', required: false, description: 'Search string.' },
          { name: 'mag7', in: 'query', type: 'boolean', required: false, description: 'Return only MAG7 tickers.' },
          { name: 'include_metadata', in: 'query', type: 'boolean', required: false, description: 'Include sector/ETF per ticker.' },
        ],
        responses: [{ status: 200, description: 'Ticker list or search results.' }],
      },
      {
        path: '/health',
        method: 'get',
        summary: 'Service health check',
        description: 'Returns current service status, version, and capability availability. Free, no auth required.',
        operationId: 'getHealth',
        tag: 'Utility',
        params: [],
        responses: [{ status: 200, description: 'Service is up.' }],
      },
    ],
  },
  {
    name: 'Account',
    description: 'Balance, billing, and invoice management.',
    endpoints: [
      {
        path: '/balance',
        method: 'get',
        summary: 'Account balance and rate limits',
        description: 'Returns current prepaid balance, account status, and rate-limit settings for the authenticated token.',
        operationId: 'getBalance',
        tag: 'Account',
        params: [],
        responses: [
          { status: 200, description: 'Account balance and status.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/invoices',
        method: 'get',
        summary: 'Invoice history and spend summary',
        description: 'Returns paginated invoice history and a summary of spend by period.',
        operationId: 'getInvoices',
        tag: 'Account',
        params: [],
        responses: [
          { status: 200, description: 'Invoice history.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
        ],
      },
    ],
  },
  {
    name: 'Authentication',
    description: 'API key provisioning and OAuth2 token management.',
    endpoints: [
      {
        path: '/auth/token',
        method: 'post',
        summary: 'Generate OAuth2 Access Token',
        description: 'OAuth 2.0 client credentials flow for machine-to-machine authentication. Exchange API credentials for a short-lived JWT (15 min).',
        operationId: 'generateOAuthToken',
        tag: 'Authentication',
        params: [],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            {
              grant_type: 'client_credentials',
              client_id: 'rm_agent_live_abc123',
              client_secret: 'rm_agent_live_abc123_xyz789_checksum',
              scope: 'ticker-returns risk-decomposition',
            },
            null,
            2
          ),
        },
        responses: [
          { status: 200, description: 'Access token generated successfully.' },
          { status: 400, description: 'Invalid request.' },
          { status: 401, description: 'Invalid credentials.' },
        ],
      },
      {
        path: '/auth/provision',
        method: 'post',
        summary: 'Provision API Key',
        description: 'Create a new API key for the authenticated user.',
        operationId: 'provisionApiKey',
        tag: 'Authentication',
        params: [],
        responses: [
          { status: 200, description: 'API key created.' },
          { status: 401, description: 'Authentication required.' },
        ],
      },
    ],
  },
  {
    name: 'Billing',
    description: 'Cost estimation and pricing.',
    endpoints: [
      {
        path: '/estimate',
        method: 'post',
        sidebarLabel: 'Cost Estimate',
        summary: 'Estimate request cost',
        description: 'Returns predicted cost before a request is made. Free to call, requires authentication.',
        operationId: 'estimateCost',
        tag: 'Billing',
        params: [],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify({ endpoint: 'ticker-returns', params: { ticker: 'AAPL', years: 5 } }, null, 2),
        },
        responses: [
          { status: 200, description: 'Cost estimate.' },
          { status: 400, description: 'Unknown endpoint or invalid request.' },
          { status: 401, description: 'Authentication required.' },
        ],
      },
    ],
  },
];

export function getEndpointById(operationId: string): Endpoint | undefined {
  for (const group of ENDPOINT_GROUPS) {
    const found = group.endpoints.find((e) => e.operationId === operationId);
    if (found) return found;
  }
  return undefined;
}

export function getEndpointByPathAndMethod(path: string, method: HttpMethod): Endpoint | undefined {
  for (const group of ENDPOINT_GROUPS) {
    const found = group.endpoints.find((e) => e.path === path && e.method === method);
    if (found) return found;
  }
  return undefined;
}
