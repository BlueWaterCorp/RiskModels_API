/** Static index for Fuse.js portal search (docs + main routes). Update when adding MDX pages. */
export type PortalSearchItem = {
  title: string;
  description: string;
  href: string;
  /** Extra tokens for matching (comma-separated) */
  keywords?: string;
};

export const PORTAL_SEARCH_INDEX: PortalSearchItem[] = [
  {
    title: 'Home',
    description: 'Agentic risk API landing — hedge ratios, factor decomposition, AI-ready workflows.',
    href: '/',
    keywords: 'erm3 equity factors mcp agents',
  },
  {
    title: 'API Documentation',
    description: 'Strategic hub for ERM3 — integration, methodology, field semantics, Python SDK.',
    href: '/docs/api',
    keywords:
      'openapi endpoints core batch metrics ticker returns correlation macro factors inflation term_spread short_rates credit oil gold usd volatility bitcoin vix_spot vix dxy ust10y2y spearman pearson',
  },
  {
    title: 'Methodology',
    description: 'Mathematics and portfolio interpretation of L1/L2/L3 hedge ratios and explained risk.',
    href: '/docs/methodology',
    keywords: 'regression orthogonalization variance hedge ratio er hr',
  },
  {
    title: 'ERM3 Engine Design',
    description: 'Time safety, Security Master, tradeable ETF hedges, engine architecture.',
    href: '/docs/erm3-engine',
    keywords: 'point in time identity zarr parity',
  },
  {
    title: 'Agent Integration',
    description: 'MCP server, Cursor rules, CLI, and prompt patterns for AI agents.',
    href: '/docs/agent-integration',
    keywords: 'claude desktop mcp cursor riskmodels-cli',
  },
  {
    title: 'Authentication Guide',
    description: 'OAuth2 client credentials, Bearer tokens, billing, and API key provisioning.',
    href: '/docs/authentication',
    keywords: 'jwt stripe prepaid oauth scope',
  },
  {
    title: 'Plaid Holdings',
    description: 'Connect brokerage accounts and pull holdings into batch and metrics workflows.',
    href: '/docs/plaid-holdings',
    keywords: 'brokerage portfolio link',
  },
  {
    title: 'Macro factors and correlation',
    description:
      'Canonical macro keys, stock–macro correlation (gross and L1/L2/L3 residuals), and raw GET /macro-factors time series.',
    href: '/docs/macro-factors',
    keywords:
      'macro_factors inflation term_spread short_rates credit oil gold usd volatility bitcoin vix_spot vix dxy ust10y2y correlation return_type l3_residual GET macro-factors series',
  },
  {
    title: 'Returns decomposition (CFR / FR / RR)',
    description:
      'Daily l*_cfr / l*_fr / l*_rr metrics from ds_erm3_returns. *_cfr is cumulative-through-level, *_fr is incremental per-level, *_rr is residual at level. For stacked decomposition charts and agent attribution.',
    href: '/docs/returns-decomposition-metrics',
    keywords:
      'l1_cfr l1_fr l1_rr l2_cfr l2_fr l2_rr l3_cfr l3_fr l3_rr combined factor return incremental residual return decomposition attribution stacked security_history_returns_decomp zarr ticker-returns',
  },
  {
    title: 'Response metadata and headers',
    description:
      'JSON _metadata lineage, Zarr history data_source and range, X-Risk-* and billing headers, JSON vs Parquet or CSV exports, health teo_coverage.',
    href: '/docs/response-metadata',
    keywords:
      '_metadata data_source range X-Risk-Model-Version X-Data-As-Of X-API-Cost-USD parquet csv tabular teo_coverage latest_session_returns_pending health',
  },
  {
    title: 'API Reference',
    description: 'Interactive OpenAPI / Redoc — live schemas and request examples.',
    href: '/api-reference',
    keywords: 'openapi redoc swagger rest correlation macro factors vix bitcoin',
  },
  {
    title: 'Macro factor correlation',
    description:
      'Pearson or Spearman correlation of stock returns (gross or L1/L2/L3 residual) vs Bitcoin, Gold, Oil, DXY, VIX, UST 10y–2y.',
    href: '/docs/api#risk-metrics',
    keywords: 'correlation macro inflation term_spread short_rates credit oil gold usd volatility bitcoin vix_spot vix dxy ust10y2y spearman pearson POST correlation',
  },
  {
    title: 'Quickstart',
    description:
      'Install riskmodels-py from PyPI, first calls, SDK vs raw HTTP, Google Colab notebook, DD snapshots, response metadata.',
    href: '/quickstart',
    keywords:
      'python pip pypi xarray from_env colab notebook snapshot security-history _metadata lineage',
  },
  {
    title: 'Pricing',
    description: 'Usage-based costs, free tier, rate limits, and telemetry headers.',
    href: '/pricing',
    keywords: 'balance invoices cost per call',
  },
  {
    title: 'Usage',
    description: 'Account usage dashboard and spend for authenticated developers.',
    href: '/account/usage',
    keywords: 'dashboard billing history',
  },
  {
    title: 'Get API Key',
    description: 'Sign in, provision keys, Stripe setup, and developer dashboard.',
    href: '/get-key',
    keywords: 'signup github magic link dashboard',
  },
  {
    title: 'Legal',
    description: 'Terms and policies for the RiskModels API and portal.',
    href: '/legal',
    keywords: 'terms privacy',
  },
];
