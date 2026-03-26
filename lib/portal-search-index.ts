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
    keywords: 'openapi endpoints core batch metrics ticker returns',
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
    title: 'API Reference',
    description: 'Interactive OpenAPI / Redoc — live schemas and request examples.',
    href: '/api-reference',
    keywords: 'openapi redoc swagger rest',
  },
  {
    title: 'Quickstart',
    description: 'Install riskmodels-py from PyPI, first calls, SDK vs raw HTTP, environment variables.',
    href: '/quickstart',
    keywords: 'python pip pypi xarray from_env',
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
