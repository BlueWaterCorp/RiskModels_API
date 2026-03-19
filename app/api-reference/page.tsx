'use client';

import { useState } from 'react';
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

const BASE_URL = 'https://riskmodels.net/api';

function methodVariant(m: HttpMethod): 'get' | 'post' | 'put' | 'delete' | 'patch' {
  return m in { get: 1, post: 1, put: 1, delete: 1, patch: 1 } ? m : 'get';
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
        ticker: 'NVDA',
        symbol: 'NVDA',
        date: '2026-02-21',
        volatility: 0.48,
        sharpe_ratio: 1.82,
        l1_market_hr: 1.72,
        l1_market_er: 0.42,
        l2_market_hr: 1.41,
        l2_sector_hr: 0.31,
        l3_market_hr: 1.28,
        l3_sector_hr: 0.24,
        l3_subsector_hr: -0.06,
        sector_etf: 'XLK',
        subsector_etf: 'XOP',
        market_cap: 3200000000000,
        close_price: 131.5,
        _agent: { cost_usd: 0.005, latency_ms: 145, request_id: 'req_abc123' },
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'getTickerReturns') {
    return JSON.stringify(
      {
        meta: { ticker: 'NVDA', years: 1, rows: 252 },
        data: [
          { date: '2026-02-21', gross_return: 0.012, l1: 1.72, l2: 1.65, l3: 1.58 },
          { date: '2026-02-20', gross_return: -0.008, l1: 1.71, l2: 1.64, l3: 1.57 },
        ],
        _agent: { cost_usd: 0.005, cache_status: 'HIT' },
      },
      null,
      2
    );
  }
  if (endpoint.operationId === 'estimateCost') {
    return JSON.stringify(
      {
        estimated_cost_usd: 0.005,
        estimated_rows: 1260,
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
  const [selectedId, setSelectedId] = useState<string>('getMetrics');
  const [search, setSearch] = useState('');
  const [estimateApiKey, setEstimateApiKey] = useState('');
  const [estimateResponse, setEstimateResponse] = useState<Record<string, unknown> | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const selected = getEndpointById(selectedId) ?? ENDPOINT_GROUPS[0]?.endpoints[0];

  async function handleRunEstimate() {
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
                  defaultOpen={group.name === 'Risk Metrics'}
                >
                  <ul className="space-y-0.5">
                    {group.endpoints.map((ep) => (
                      <li key={ep.operationId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(ep.operationId)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors',
                            selectedId === ep.operationId
                              ? 'bg-zinc-800 border-l-4 border-blue-500 text-white'
                              : 'hover:bg-zinc-800/70 text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          <Badge variant={methodVariant(ep.method)} className="shrink-0">
                            {ep.method.toUpperCase()}
                          </Badge>
                          <span className="truncate font-mono text-xs">{ep.sidebarLabel ?? ep.path}</span>
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
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={methodVariant(selected.method)} className="text-base px-4 py-1">
                {selected.method.toUpperCase()}
              </Badge>
              <code className="text-xl lg:text-2xl font-mono text-zinc-200">{BASE_URL}{selected.path}</code>
            </div>

            <p className="text-zinc-400 text-base leading-relaxed max-w-3xl">{selected.description}</p>

            {selected.params.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-zinc-100 mb-4 tracking-tight">
                  {selected.params.some((p) => p.in === 'body') ? 'Request Body' : 'Parameters'}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Param</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Required</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.params.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell>
                          <code className="font-mono text-zinc-200">{p.name}</code>
                        </TableCell>
                        <TableCell className="text-zinc-400">{p.type}</TableCell>
                        <TableCell>{p.description}</TableCell>
                        <TableCell>{p.required ? 'Yes' : p.default ? `Default: ${p.default}` : 'No'}</TableCell>
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
            <Tabs
              tabs={[
                {
                  value: 'request',
                  label: 'Request',
                  content: (
                    <div className="space-y-4 mt-2">
                      <CodeBlock
                        code={getRequestExample(selected)}
                        showCopy
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
                                showCopy
                                language="json"
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
                      <CodeBlock code={getResponseExample(selected)} showCopy />
                    </div>
                  ),
                },
              ]}
              defaultValue="request"
            />
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
