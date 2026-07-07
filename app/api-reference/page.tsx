'use client';

import { useEffect, useState } from 'react';
import { gtmAnalytics } from '@/lib/posthog-client';
import Link from 'next/link';
import { Search, ExternalLink, Play } from 'lucide-react';
import { AccordionItem } from '@/components/ui/Accordion';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Input } from '@/components/ui/Input';
import { ENDPOINT_GROUPS, getEndpointById, type Endpoint, type HttpMethod } from '@/lib/api-reference-data';
import { cn } from '@/lib/cn';

const BASE_URL = 'https://riskmodels.app/api';

function methodVariant(m: HttpMethod): 'get' | 'post' | 'put' | 'delete' | 'patch' {
  return m in { get: 1, post: 1, put: 1, delete: 1, patch: 1 } ? m : 'get';
}

function getRequestLanguage(endpoint: Endpoint): 'http' | 'json' {
  return endpoint.method === 'get' ? 'http' : 'json';
}

function getRequestExample(endpoint: Endpoint): string {
  if (endpoint.method === 'get') {
    const path = endpoint.path.replace('{ticker}', 'NVDA');
    const queryParams = endpoint.params.filter((p) => p.in === 'query');
    const qs = queryParams.length
      ? '?' + queryParams.map((p) => `${p.name}=${p.default ?? (p.type === 'string' ? 'NVDA' : '1')}`).join('&')
      : '';
    return `GET ${BASE_URL}${path}${qs}`;
  }
  return endpoint.requestBody?.example ?? `POST ${BASE_URL}${endpoint.path}`;
}

function getResponseExample(endpoint: Endpoint): string {
  if (endpoint.operationId === 'getMetrics') {
    return JSON.stringify(
      {
        symbol: 'NVDA-US',
        ticker: 'NVDA',
        teo: '2026-03-17',
        periodicity: 'daily',
        metrics: {
          vol_23d: 0.48,
          price_close: 131.5,
          market_cap: 3200000000000,
          l3_mkt_hr: 1.28,
          l3_sec_hr: 0.24,
          l3_sub_hr: -0.06,
          l3_mkt_er: 0.42,
          l3_sec_er: 0.15,
          l3_sub_er: 0.08,
          l3_res_er: 0.35,
        },
        meta: {
          sector_etf: 'XLK',
          asset_type: 'EQUITY',
        },
        _metadata: {
          model_version: 'ERM3-L3-v30',
          data_as_of: '2026-03-17',
        },
        _agent: { cost_usd: 0.005, latency_ms: 145, request_id: 'req_abc123' },
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'getTickerReturns') {
    return JSON.stringify(
      {
        symbol: 'NVDA-US',
        ticker: 'NVDA',
        periodicity: 'daily',
        data: [
          {
            date: '2026-03-17',
            returns_gross: 0.012,
            price_close: 131.5,
            l3_mkt_hr: 1.28,
            l3_sec_hr: 0.24,
            l3_sub_hr: -0.06,
          },
          {
            date: '2026-03-16',
            returns_gross: -0.008,
            price_close: 130.2,
            l3_mkt_hr: 1.27,
            l3_sec_hr: 0.23,
            l3_sub_hr: -0.05,
          },
        ],
        meta: {
          market_etf: 'SPY',
          sector_etf: 'XLK',
          universe: 'US_EQUITY',
        },
        _metadata: {
          data_as_of: '2026-03-17',
        },
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'batchAnalyze') {
    return JSON.stringify(
      {
        results: {
          NVDA: {
            ticker: 'NVDA',
            status: 'success',
            full_metrics: {
              ticker: 'NVDA',
              date: '2026-03-17',
              volatility: 0.48,
              l3_mkt_hr: 1.28,
              l3_sec_hr: 0.24,
              l3_sub_hr: -0.06,
            },
          },
        },
        summary: { total: 1, success: 1, errors: 0 },
        _agent: { cost_usd: 0.01, request_id: 'req_batch123' },
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'getL3Decomposition') {
    return JSON.stringify(
      {
        ticker: 'NVDA',
        dates: ['2026-03-17', '2026-03-16'],
        l3_mkt_hr: [1.28, 1.27],
        l3_sec_hr: [0.24, 0.23],
        l3_sub_hr: [-0.06, -0.05],
        l3_mkt_er: [0.42, 0.41],
        l3_sec_er: [0.15, 0.14],
        l3_sub_er: [0.08, 0.07],
        l3_res_er: [0.35, 0.38],
        market_factor_etf: 'SPY',
        universe: 'US_EQUITY',
        data_source: 'security_history',
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'getFundamentals') {
    return JSON.stringify(
      {
        ticker: 'AAPL',
        as_of: '2026-07-03',
        periods_returned: 1,
        rows: [
          {
            period_end_date: '2025-12-31',
            filed_date: '2026-01-30',
            filed_date_source: 'exact',
            roe_ttm: 1.599,
            roa_ttm: 0.336,
            leverage_ratio: 1.026,
            fcf_margin: 0.283,
            beta_market: 1.064,
            beta_source: 'in-universe',
            cost_of_equity: null,
            wacc: null,
          },
        ],
        market_cap: { value: 3500000000000, basis: 'current_snapshot' },
        disclosures: {
          realized_historical_only:
            'This endpoint surfaces only realized historical data. No forecasts, no analyst targets, no buy/sell signals.',
          parameters: { as_of: '2026-07-03', erp: 0.05, tax_rate: 0.21 },
        },
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'estimateCost') {
    return JSON.stringify(
      {
        estimated_cost_usd: 0.005,
        estimated_rows: 252,
        capability: 'ticker-returns',
        pricing_model: 'per_request',
        unit_cost_usd: 0.005,
        note: 'Actual cost may vary. Cached responses are free.',
      },
      null,
      2
    );
  }
  return JSON.stringify({ status: 'success', message: 'Response varies by endpoint.' }, null, 2);
}

const ESTIMATE_REQUEST_BODY = { endpoint: 'ticker-returns', params: { ticker: 'AAPL', years: 5 } };

export default function ApiReferencePage() {
  const [selectedId, setSelectedId] = useState<string>('getTickerReturns');
  const [search, setSearch] = useState('');
  const [estimateApiKey, setEstimateApiKey] = useState('');
  const [estimateResponse, setEstimateResponse] = useState<Record<string, unknown> | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const selected = getEndpointById(selectedId) ?? ENDPOINT_GROUPS[0]?.endpoints[0];

  useEffect(() => {
    gtmAnalytics.apiDocsPageViewed('api-reference');
  }, []);

  useEffect(() => {
    if (selectedId === 'coreConcepts') return;
    const endpoint = getEndpointById(selectedId);
    if (endpoint) {
      gtmAnalytics.apiEndpointExpanded(endpoint.path, endpoint.method);
    }
  }, [selectedId]);

  async function handleRunEstimate() {
    gtmAnalytics.tryApiClicked('/estimate');
    setEstimateLoading(true);
    setEstimateError(null);
    setEstimateResponse(null);
    try {
      const res = await fetch(`${BASE_URL}/estimate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(estimateApiKey.trim() && { Authorization: `Bearer ${estimateApiKey.trim()}` }),
        },
        body: JSON.stringify(ESTIMATE_REQUEST_BODY),
      });
      const data = await res.json();
      if (!res.ok) {
        setEstimateError(data.message ?? data.error ?? `HTTP ${res.status}`);
      } else {
        setEstimateResponse(data);
      }
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setEstimateLoading(false);
    }
  }

  const filteredGroups = ENDPOINT_GROUPS.map((group) => ({
    ...group,
    endpoints: search
      ? group.endpoints.filter(
          (e) =>
            e.path.toLowerCase().includes(search.toLowerCase()) ||
            e.summary.toLowerCase().includes(search.toLowerCase()) ||
            e.operationId.toLowerCase().includes(search.toLowerCase())
        )
      : group.endpoints,
  })).filter((g) => g.endpoints.length > 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="grid grid-cols-12 min-h-screen">
        {/* Sidebar */}
        <aside className="col-span-12 lg:col-span-3 border-r border-zinc-800 bg-zinc-950/95 backdrop-blur-sm sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="p-4 lg:p-6 space-y-6">
            <div>
              <label htmlFor="api-search" className="sr-only">
                Search endpoints
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input
                  id="api-search"
                  placeholder="Search endpoints…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-zinc-900"
                />
              </div>
            </div>

            <nav className="space-y-1">
              {filteredGroups.map((group) => (
                <AccordionItem
                  key={group.name}
                  value={group.name}
                  trigger={<span>{group.name}</span>}
                  defaultOpen={group.name === 'Core Concepts' || group.name === 'Risk Metrics'}
                >
                  <ul className="space-y-0.5">
                    {group.endpoints.map((ep) => (
                      <li key={ep.operationId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(ep.operationId)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-all duration-200',
                            selectedId === ep.operationId
                              ? [
                                  'bg-primary/10 text-white',
                                  'ring-1 ring-primary/35',
                                  'shadow-[0_0_24px_-6px_hsl(var(--primary)_/_0.5)]',
                                  'border-l-2 border-primary',
                                ]
                              : 'border-l-2 border-transparent hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          <Badge variant={methodVariant(ep.method)} className="shrink-0">
                            {ep.method.toUpperCase()}
                          </Badge>
                          <span className="truncate font-mono text-xs tabular-nums">
                            {ep.sidebarLabel ?? ep.path}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </AccordionItem>
              ))}
            </nav>

            <div className="pt-6 border-t border-zinc-800">
              <a
                href="/get-key"
                onClick={() => gtmAnalytics.ctaClicked('Get API Key', 'api_reference_sidebar')}
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-blue-400 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Get API Key
              </a>
            </div>
          </div>
        </aside>

        {/* Main + Right Panel */}
        <main className="col-span-12 lg:col-span-9 grid grid-cols-1 xl:grid-cols-12">
          {/* Main content */}
          <div className="col-span-1 xl:col-span-8 p-6 lg:p-8 space-y-8">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-sm font-medium text-emerald-300">
                Returns variance + hedge ratios.
              </p>
            </div>

            {selectedId === 'coreConcepts' ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight mb-2">Core Outputs You Actually Care About</h2>
                  <p className="text-zinc-400 max-w-3xl">
                    The RiskModels API’s primary value is a clean, additive, hierarchical decomposition of risk and return.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div className="font-mono text-xs uppercase tracking-widest text-terminal mb-2">Hedge Ratios (HR)</div>
                    <p className="text-sm text-zinc-300 mb-3">
                      Dollar-notional ratios. “How many dollars of SPY (or XLK, or SMH) do I need to trade to neutralize this layer?”
                    </p>
                    <code className="text-xs text-zinc-400">l3_mkt_hr, l3_sec_hr, l3_sub_hr</code>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div className="font-mono text-xs uppercase tracking-widest text-terminal mb-2">Explained Risk (ER)</div>
                    <p className="text-sm text-zinc-300 mb-3">
                      Variance fractions. How much of the stock’s risk is coming from each layer. They add to ~100%.
                    </p>
                    <code className="text-xs text-zinc-400">l3_mkt_er, l3_sec_er, l3_sub_er, l3_res_er</code>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="font-mono text-xs uppercase tracking-widest text-terminal mb-2">Residual Component</div>
                  <p className="text-sm text-zinc-300">
                    What remains after stripping market, sector, and subsector. This is the closest thing the model has to “stock-specific” or manager-driven return/risk.
                    Look for <code className="text-zinc-400">l3_res_er</code> (explained) and residual returns in the time-series endpoints.
                  </p>
                </div>

                <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-5">
                  <div className="font-mono text-xs uppercase tracking-widest text-amber-400 mb-2">Best Residual — Lstar Dispatch</div>
                  <p className="text-sm text-zinc-300 mb-2">
                    Not every stock’s subsector ETF actually explains material variance. <strong>Lstar</strong> picks the deepest cascade level that clears a 1% marginal-ER bar — L3 only when subsector hedging adds real explanatory power, L2 when only sector does, L1 otherwise.
                  </p>
                  <p className="text-sm text-zinc-300">
                    <code className="text-zinc-400">lstar_rr</code> returns the residual <em>at the level the model actually picked</em>;{' '}
                    <code className="text-zinc-400">lstar_level</code> (1/2/3/null) tells you which level. Prefer these over a blind <code className="text-zinc-400">l3_rr</code> for panel queries — fixed-L3 overstates residual cleanness when subsector signal is weak.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div className="font-mono text-xs uppercase tracking-widest text-terminal mb-2">Industry peer β</div>
                    <p className="text-sm text-zinc-300 mb-2">
                      Vasicek peer-β cross-section by EODHD industry × cascade level — what the model thinks an industry&rsquo;s typical β is, plus how dispersed its members are.
                    </p>
                    <p className="text-xs text-zinc-500">
                      <code className="text-zinc-400">GET /api/industry-panel</code> — the macro / sector-rotation surface.
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div className="font-mono text-xs uppercase tracking-widest text-terminal mb-2">Universe rank screen</div>
                    <p className="text-sm text-zinc-300 mb-2">
                      Server-side percentile / decile / sector filters over the full ranking cross-section. The stat-arb cross-section in one call — not N per-ticker round-trips.
                    </p>
                    <p className="text-xs text-zinc-500">
                      <code className="text-zinc-400">POST /api/rankings/screen</code> — up to 500 rows by <code className="text-zinc-400">rank_ordinal</code>.
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div className="font-mono text-xs uppercase tracking-widest text-terminal mb-2">Panel Lstar history</div>
                    <p className="text-sm text-zinc-300 mb-2">
                      Per-ticker daily Lstar level + dispatched residual return for up to 100 tickers in one request. The history companion to <code className="text-zinc-400">lstar_rr</code> in MetricsV3.
                    </p>
                    <p className="text-xs text-zinc-500">
                      <code className="text-zinc-400">POST /api/batch/lstar</code> — $0.005/ticker, 25% cheaper than looping.
                    </p>
                  </div>
                </div>

                <p className="text-sm text-zinc-500">
                  Best endpoints for these outputs: <strong>/metrics/{'{ticker}'}</strong>, <strong>/ticker-returns</strong>, <strong>/returns-decomposition</strong>, <strong>/industry-panel</strong>, <strong>/rankings/screen</strong>, and <strong>/batch/lstar</strong>.
                </p>
              </div>
            ) : selectedId === 'agentOnboarding' ? (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight mb-3">Fastest way to get started with agents</h2>
                  <p className="text-zinc-400 max-w-2xl">
                    Paste one line into any AI chat (Claude, ChatGPT, Grok, Gemini web, Cursor). The agent reads riskmodels.app, wires itself up for the conversation, and tells you what it can do — no install, no terminal.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Paste this into a fresh chat (copy &amp; paste)</div>
                    <div className="relative rounded-xl border border-zinc-800 bg-zinc-950 p-5 font-mono text-sm text-zinc-200 whitespace-pre-wrap">
{`Visit riskmodels.app and set it up to use in this chat, then tell me what you can analyze.`}
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                      Want it permanently in Claude or Cursor? Settings → Connectors → Add custom connector → paste{' '}
                      <code className="text-zinc-400">https://riskmodels.app/api/mcp/sse</code> and Connect — sign in, no key needed. ChatGPT Plus: Developer mode under Apps &amp; Connectors. Grok:{' '}
                      <code className="text-zinc-400">grok.com/connectors</code> → Custom. Gemini: CLI or Enterprise (consumer web uses REST only). Details in the{' '}
                      <Link href="/docs/agent-integration" className="text-terminal hover:underline">agent integration guide</Link>.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => navigator.clipboard.writeText(`Visit riskmodels.app and set it up to use in this chat, then tell me what you can analyze.`)}
                      className="px-4 py-2 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-900 transition-colors"
                    >
                      Copy agent prompt
                    </button>
                    <a
                      href="https://riskmodels.app/installation"
                      target="_blank"
                      className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors inline-flex items-center gap-2"
                    >
                      Install + MCP guide
                    </a>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Example prompt starters</div>
                  <div className="grid gap-2 text-sm">
                    {[
                      "I want to understand how much of my portfolio's risk is truly residual vs coming from sector and subsector bets.",
                      "Help me generate dynamic ETF hedges for my top 20 long positions using L3 decomposition.",
                      "I'm looking at several 13F filers — decompose their recent filings into market, thematic, and stock-specific risk.",
                      "For my concentrated healthcare book, show me names where residual risk is high but the market is pricing in a lot of sector beta.",
                    ].map((example, i) => (
                      <button
                        key={i}
                        onClick={() => navigator.clipboard.writeText(`Visit riskmodels.app and set it up to use in this chat. Then help me with this:

${example}`)}
                        className="text-left px-4 py-3 rounded-lg border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 transition-all"
                      >
                        “{example}”
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-sm text-zinc-500 border-t border-zinc-800 pt-6">
                  Common high-value agent use cases: portfolio residual analysis, dynamic hedging, 13F decomposition, manager skill attribution, and pre-trade risk screening.
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={methodVariant(selected.method)} className="text-base px-4 py-1">
                    {selected.method.toUpperCase()}
                  </Badge>
                  <code className="text-xl lg:text-2xl font-mono tabular-nums text-zinc-200">
                    {BASE_URL}
                    {selected.path}
                  </code>
                </div>

                <p className="text-zinc-400 text-base leading-relaxed max-w-3xl">{selected.description}</p>
              </>
            )}

            {selected.params.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-zinc-100 mb-4 tracking-tight">
                  {selected.params.some((p) => p.in === 'body') ? 'Request Body' : 'Parameters'}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Param</TableHead>
                      <TableHead className="text-slate-400 normal-case tracking-normal">Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead className="text-slate-400 normal-case tracking-normal">Default</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.params.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell>
                          <code className="font-mono text-sm tabular-nums text-zinc-200">{p.name}</code>
                        </TableCell>
                        <TableCell className="text-slate-400">{p.type}</TableCell>
                        <TableCell className="text-zinc-400">{p.description}</TableCell>
                        <TableCell className="text-zinc-400">{p.required ? 'Yes' : 'No'}</TableCell>
                        <TableCell className="text-slate-400 font-mono text-xs tabular-nums">
                          {p.default ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            <section>
              <h3 className="text-lg font-semibold text-zinc-100 mb-4 tracking-tight">Response Codes</h3>
              <div className="flex flex-wrap gap-2">
                {selected.responses.map((r) => (
                  <div key={r.status} className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-sm text-zinc-400">{r.description}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right sticky panel */}
          <div className="col-span-1 xl:col-span-4 border-l border-zinc-800 bg-zinc-950/80 p-6 sticky top-16 h-fit xl:max-h-[calc(100vh-4rem)] overflow-y-auto">
            {(selectedId === 'coreConcepts' || selectedId === 'agentOnboarding') ? (
              <div className="space-y-6 pt-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-3">Python SDK highlights</div>
                  <div className="space-y-4 text-sm">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                      <div className="font-mono text-[11px] text-emerald-400 mb-2">CLI — fastest for terminal/agents</div>
                      <pre className="text-xs text-zinc-300 overflow-x-auto">riskmodels metrics NVDA
riskmodels l3 NVDA
riskmodels returns ticker NVDA --years 3</pre>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                      <div className="font-mono text-[11px] text-emerald-400 mb-2">Python SDK (nice names + DataFrames)</div>
                      <pre className="text-xs text-zinc-300 overflow-x-auto">{`from riskmodels import RiskModelsClient
client = RiskModelsClient.from_env()
print(client.metrics("NVDA").l3_res_er)
df = client.ticker_returns("NVDA", years=3)`}</pre>
                    </div>

                    <div className="text-[11px] text-zinc-500">
                      CLI: <code>npx -y riskmodels@latest install</code> wires MCP + config. SDK renames fields (l3_mkt_hr → l3_market_hr) with semantic metadata.
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800">
                  <a href="https://riskmodels.app/docs/python-sdk" target="_blank" className="text-sm text-blue-400 hover:text-blue-300">
                    Full Python SDK docs →
                  </a>
                </div>
              </div>
            ) : (
              <Tabs
                tabs={[
                  {
                    value: 'request',
                    label: 'Request',
                    content: (
                      <div className="space-y-4 mt-2">
                        <CodeBlock
                          code={getRequestExample(selected)}
                          language={getRequestLanguage(selected)}
                          showCopy
                          onCopy={() => gtmAnalytics.apiExampleCopied(selected.path)}
                        />
                        {selectedId === 'estimateCost' && (
                        <div className="pt-4 border-t border-zinc-800 space-y-3">
                          <h4 className="text-sm font-semibold text-zinc-200">Try it out</h4>
                          <div>
                            <label htmlFor="estimate-api-key" className="block text-xs text-zinc-500 mb-1">
                              API Key (required)
                            </label>
                            <Input
                              id="estimate-api-key"
                              type="password"
                              placeholder="rm_agent_live_..."
                              value={estimateApiKey}
                              onChange={(e) => setEstimateApiKey(e.target.value)}
                              className="bg-zinc-900 font-mono text-sm"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleRunEstimate}
                            disabled={estimateLoading || !estimateApiKey.trim()}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                          >
                            <Play size={14} />
                            {estimateLoading ? 'Running…' : 'Run Request'}
                          </button>
                          {estimateError && (
                            <p className="text-sm text-red-400">{estimateError}</p>
                          )}
                          {estimateResponse && (
                            <div className="mt-2">
                              <p className="text-xs text-zinc-500 mb-1">Response</p>
                              <CodeBlock
                                code={JSON.stringify(estimateResponse, null, 2)}
                                language="json"
                                showCopy
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  value: 'response',
                  label: 'Response',
                  content: (
                    <div className="space-y-2 mt-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={200} />
                        <span className="text-xs text-zinc-400">Success</span>
                      </div>
                      <CodeBlock
                        code={getResponseExample(selected)}
                        language="json"
                        showCopy
                        onCopy={() => gtmAnalytics.apiExampleCopied(`${selected.path} (response)`)}
                      />
                    </div>
                  ),
                },
              ]}
              defaultValue="request"
            />
            )}
          </div>
        </main>
      </div>

      {/* Full OpenAPI link */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-zinc-400">
            Full OpenAPI 3.0.3 specification available for download and tooling integration.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/openapi.json"
              target="_blank"
              className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              openapi.json
            </Link>
            <Link
              href="/api-docs.html"
              target="_blank"
              className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              Redoc (full spec)
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
