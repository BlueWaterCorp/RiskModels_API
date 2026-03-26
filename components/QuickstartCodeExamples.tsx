'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import CodeBlock from '@/components/CodeBlock';
import {
  isQuickstartExampleTabId,
  type QuickstartExampleTabId,
} from '@/lib/quickstart-examples';

// ─── 1) Daily factor decomposition — GET /l3-decomposition ─────────────────

const pythonDecomposition = `#!/usr/bin/env python3
"""
Daily / monthly factor decomposition — explained risk (ER) by level.

GET /l3-decomposition returns parallel arrays: market, sector, subsector, residual ER (and HR).
pip install requests
"""

import requests

API_KEY = "rm_agent_live_..."
BASE_URL = "https://riskmodels.app/api"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

ticker = "NVDA"
resp = requests.get(
    f"{BASE_URL}/l3-decomposition",
    headers=HEADERS,
    params={"ticker": ticker},
)
resp.raise_for_status()
body = resp.json()

# Latest month in the series
i = len(body["dates"]) - 1
d = body["dates"][i]

def pct(x):
    return f"{x:.1%}" if x is not None else "n/a"

print(f"L3 explained risk as of {d} ({ticker}):")
print(f"  Market:    {pct(body['l3_market_er'][i])}")
print(f"  Sector:    {pct(body['l3_sector_er'][i])}")
print(f"  Subsector: {pct(body['l3_subsector_er'][i])}")
print(f"  Residual:  {pct(body['l3_residual_er'][i])}")`;

const typescriptDecomposition = `/**
 * Monthly L3 factor decomposition (TypeScript)
 */

const API_KEY = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.app/api";
const HEADERS = { Authorization: \`Bearer \${API_KEY}\` };

interface L3Body {
  dates: string[];
  l3_market_er: (number | null)[];
  l3_sector_er: (number | null)[];
  l3_subsector_er: (number | null)[];
  l3_residual_er: (number | null)[];
}

function pct(x: number | null | undefined) {
  return x != null ? \`\${(x * 100).toFixed(1)}%\` : "n/a";
}

async function main() {
  const url = new URL(\`\${BASE_URL}/l3-decomposition\`);
  url.searchParams.set("ticker", "NVDA");

  const resp = await fetch(url.toString(), { headers: HEADERS });
  if (!resp.ok) throw new Error(\`API error: \${resp.status}\`);

  const body = (await resp.json()) as L3Body;
  const i = body.dates.length - 1;

  console.log(\`L3 explained risk as of \${body.dates[i]}:\`);
  console.log(\`  Market:    \${pct(body.l3_market_er[i])}\`);
  console.log(\`  Sector:    \${pct(body.l3_sector_er[i])}\`);
  console.log(\`  Subsector: \${pct(body.l3_subsector_er[i])}\`);
  console.log(\`  Residual:  \${pct(body.l3_residual_er[i])}\`);
}

main();`;

// ─── 2) Hedge ratios — GET /metrics/{ticker} ─────────────────────────────────

const pythonHedgeSnapshot = `#!/usr/bin/env python3
"""
Latest hedge ratios (HR) — dollar ETF notionals per $1 of stock.

GET /metrics/{ticker} returns a metrics object (V3 keys: l3_mkt_hr, l3_sec_hr, …).
pip install requests
"""

import requests

API_KEY = "rm_agent_live_..."
BASE_URL = "https://riskmodels.app/api"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

ticker = "NVDA"
resp = requests.get(f"{BASE_URL}/metrics/{ticker}", headers=HEADERS)
resp.raise_for_status()
body = resp.json()
m = body["metrics"]

print(f"{ticker} @ {body.get('teo', '?')}")
print("L3 hedge ratios ($ short ETF per $1 long stock):")
print(f"  Market:    {m.get('l3_mkt_hr') or 0:.4f}")
print(f"  Sector:    {m.get('l3_sec_hr') or 0:.4f}")
print(f"  Subsector: {m.get('l3_sub_hr') or 0:.4f}")
print("L3 explained risk:")
print(f"  Market:    {(m.get('l3_mkt_er') or 0):.1%}")
print(f"  Sector:    {(m.get('l3_sec_er') or 0):.1%}")
print(f"  Subsector: {(m.get('l3_sub_er') or 0):.1%}")
print(f"  Residual:  {(m.get('l3_res_er') or 0):.1%}")`;

const typescriptHedgeSnapshot = `/**
 * Latest metrics & hedge ratios (TypeScript)
 */

const API_KEY = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.app/api";
const HEADERS = { Authorization: \`Bearer \${API_KEY}\` };

interface MetricsBody {
  teo?: string;
  metrics: {
    l3_mkt_hr?: number | null;
    l3_sec_hr?: number | null;
    l3_sub_hr?: number | null;
    l3_mkt_er?: number | null;
    l3_sec_er?: number | null;
    l3_sub_er?: number | null;
    l3_res_er?: number | null;
  };
}

async function main() {
  const ticker = "NVDA";
  const resp = await fetch(\`\${BASE_URL}/metrics/\${ticker}\`, { headers: HEADERS });
  if (!resp.ok) throw new Error(\`API error: \${resp.status}\`);

  const body = (await resp.json()) as MetricsBody;
  const m = body.metrics;
  console.log(\`\${ticker} @ \${body.teo ?? "?"}\`);
  console.log("L3 hedge ratios ($ short ETF per $1 long stock):");
  console.log(\`  Market:    \${(m.l3_mkt_hr ?? 0).toFixed(4)}\`);
  console.log(\`  Sector:    \${(m.l3_sec_hr ?? 0).toFixed(4)}\`);
  console.log(\`  Subsector: \${(m.l3_sub_hr ?? 0).toFixed(4)}\`);
  console.log("L3 explained risk:");
  console.log(\`  Residual:  \${((m.l3_res_er ?? 0) * 100).toFixed(1)}%\`);
}

main();`;

// ─── 3) Historical time series — GET /ticker-returns ────────────────────────

const pythonHistorical = `#!/usr/bin/env python3
"""
Historical time series — daily returns + rolling L1/L2/L3 hedge ratios.

Up to 15 years per call. Each row includes daily return and L3 HR/ER fields (l3_mkt_hr, l3_sec_hr, l3_sub_hr, …).
pip install requests pandas
"""

import requests
import pandas as pd

API_KEY = "rm_agent_live_..."
BASE_URL = "https://riskmodels.app/api"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

ticker = "NVDA"
resp = requests.get(
    f"{BASE_URL}/ticker-returns",
    headers=HEADERS,
    params={"ticker": ticker, "years": 15},
)
resp.raise_for_status()
body = resp.json()

df = pd.DataFrame(body["data"])
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values("date").reset_index(drop=True)

latest = df.iloc[-1]
meta = body["meta"]
print(f"{ticker}: {len(df)} trading days through {latest['date'].date()}")
print(f"  ETFs: {meta['market_etf']} / {meta['sector_etf']} / {meta['subsector_etf']}")
print(
    f"  Latest L3 HR (mkt/sec/sub): "
    f"{(latest.get('l3_mkt_hr') or 0):.4f}, "
    f"{(latest.get('l3_sec_hr') or 0):.4f}, "
    f"{(latest.get('l3_sub_hr') or 0):.4f}"
)
print(f"  L3 residual ER: {(latest.get('l3_res_er') or 0):.1%}")`;

const typescriptHistorical = `/**
 * Historical ticker returns + rolling hedge ratios (TypeScript)
 */

const API_KEY = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.app/api";
const HEADERS = { Authorization: \`Bearer \${API_KEY}\` };

interface TickerReturnsResponse {
  meta: { market_etf: string; sector_etf: string; subsector_etf: string };
  data: Array<{
    date: string;
    returns_gross: number;
    l3_mkt_hr: number | null;
    l3_sec_hr: number | null;
    l3_sub_hr: number | null;
    l3_res_er?: number | null;
  }>;
}

async function main() {
  const ticker = "NVDA";
  const url = new URL(\`\${BASE_URL}/ticker-returns\`);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("years", "15");

  const resp = await fetch(url.toString(), { headers: HEADERS });
  if (!resp.ok) throw new Error(\`API error: \${resp.status}\`);

  const body = (await resp.json()) as TickerReturnsResponse;
  const sorted = [...body.data].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  console.log(\`\${ticker}: \${sorted.length} days through \${latest.date}\`);
  console.log(
    \`  L3 HR: \${(latest.l3_mkt_hr ?? 0).toFixed(4)}, \${(latest.l3_sec_hr ?? 0).toFixed(4)}, \${(latest.l3_sub_hr ?? 0).toFixed(4)}\`,
  );
}

main();`;

// ─── 4) Batch analysis — POST /batch/analyze ─────────────────────────────────

const pythonBatch = `#!/usr/bin/env python3
"""
Batch analysis — up to 100 tickers in one request (lower cost per name).

Request metrics: ["full_metrics", "hedge_ratios"] for full L1–L3 HR (short keys in hedge_ratios)
plus flat ER/HR in full_metrics (zarr parity: docs/ERM3_ZARR_API_PARITY.md).
pip install requests
"""

import requests

API_KEY = "rm_agent_live_..."
BASE_URL = "https://riskmodels.app/api"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

portfolio = [
    {"ticker": "AAPL", "position_usd": 50000},
    {"ticker": "MSFT", "position_usd": 75000},
    {"ticker": "NVDA", "position_usd": 100000},
]
tickers = [p["ticker"] for p in portfolio]

resp = requests.post(
    f"{BASE_URL}/batch/analyze",
    headers=HEADERS,
    json={"tickers": tickers, "metrics": ["full_metrics", "hedge_ratios"]},
)
resp.raise_for_status()
body = resp.json()

for p in portfolio:
    t = p["ticker"]
    row = body["results"][t]
    if row.get("status") != "success" or not row.get("full_metrics"):
        print(f"{t}: skipped ({row.get('error', 'no full_metrics')})")
        continue
    m = row["full_metrics"]
    pos = p["position_usd"]
    spy = pos * (m.get("l3_market_hr") or 0)
    sec = pos * (m.get("l3_sector_hr") or 0)
    print(f"{t} (\${pos:,})")
    print(f"  SPY hedge notion:    \${spy:,.0f}")
    print(f"  Sector hedge notion: \${sec:,.0f}")
    print(f"  L3 residual ER:      {m.get('l3_residual_er', 0):.1%}")
    print()

print(f"Total cost: \${body['_agent']['cost_usd']:.4f}")`;

const typescriptBatch = `/**
 * Batch portfolio analysis (TypeScript)
 */

const API_KEY = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.app/api";
const HEADERS = { Authorization: \`Bearer \${API_KEY}\` };

interface FullMetrics {
  l3_market_hr?: number | null;
  l3_sector_hr?: number | null;
  l3_residual_er?: number | null;
}

interface BatchRow {
  status: string;
  error?: string;
  full_metrics?: FullMetrics | null;
}

interface BatchBody {
  results: Record<string, BatchRow>;
  _agent: { cost_usd: number };
}

async function main() {
  const holdings = [
    { ticker: "AAPL", position_usd: 50000 },
    { ticker: "MSFT", position_usd: 75000 },
    { ticker: "NVDA", position_usd: 100000 },
  ];

  const resp = await fetch(\`\${BASE_URL}/batch/analyze\`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      tickers: holdings.map((h) => h.ticker),
      metrics: ["full_metrics", "hedge_ratios"],
    }),
  });

  if (!resp.ok) throw new Error(\`Batch error: \${resp.status}\`);
  const body = (await resp.json()) as BatchBody;

  for (const h of holdings) {
    const row = body.results[h.ticker];
    if (row.status !== "success" || !row.full_metrics) {
      console.log(\`\${h.ticker}: skipped\`);
      continue;
    }
    const m = row.full_metrics;
    const spy = h.position_usd * (m.l3_market_hr ?? 0);
    const sec = h.position_usd * (m.l3_sector_hr ?? 0);
    console.log(\`\${h.ticker}: SPY $\${spy.toFixed(0)} | sector $\${sec.toFixed(0)} | residual \${((m.l3_residual_er ?? 0) * 100).toFixed(1)}%\`);
  }
  console.log(\`Total cost: $\${body._agent.cost_usd.toFixed(4)}\`);
}

main();`;

const EXAMPLES: Record<
  'python' | 'typescript',
  Record<QuickstartExampleTabId, string>
> = {
  python: {
    decomposition: pythonDecomposition,
    hedgeSnapshot: pythonHedgeSnapshot,
    historical: pythonHistorical,
    batch: pythonBatch,
  },
  typescript: {
    decomposition: typescriptDecomposition,
    hedgeSnapshot: typescriptHedgeSnapshot,
    historical: typescriptHistorical,
    batch: typescriptBatch,
  },
};

const EXAMPLE_META: Record<
  QuickstartExampleTabId,
  { label: string; title: string; body: string; endpoint: string }
> = {
  decomposition: {
    label: 'Factor decomposition',
    title: 'Factor decomposition (explained risk)',
    body: 'Explained-risk fractions by level: market, sector, subsector, and residual — time-aligned arrays from GET /l3-decomposition.',
    endpoint: '/l3-decomposition',
  },
  hedgeSnapshot: {
    label: 'Hedge ratios',
    title: 'Latest hedge ratios (L1/L2/L3)',
    body: 'Dollar ETF hedge notionals per $1 of stock, plus ER fields, in one snapshot — GET /metrics/{ticker}.',
    endpoint: '/metrics/{ticker}',
  },
  historical: {
    label: 'Historical series',
    title: 'Historical time series',
    body: 'Up to 15 years of daily returns with rolling combined L1/L2/L3 hedge ratios — GET /ticker-returns.',
    endpoint: '/ticker-returns',
  },
  batch: {
    label: 'Batch analysis',
    title: 'Batch analysis',
    body: 'Analyze up to 100 tickers in one call — POST /batch/analyze with metrics: ["full_metrics","hedge_ratios"] for full ER/HR + zarr-style parity (see docs/ERM3_ZARR_API_PARITY.md).',
    endpoint: '/batch/analyze',
  },
};

const FILENAME: Record<QuickstartExampleTabId, string> = {
  decomposition: 'l3-decomposition',
  hedgeSnapshot: 'metrics-snapshot',
  historical: 'ticker-returns',
  batch: 'batch-analyze',
};

const EXAMPLE_IDS = Object.keys(EXAMPLE_META) as QuickstartExampleTabId[];

export default function QuickstartCodeExamples() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [activeTab, setActiveTab] = useState<'python' | 'typescript'>('python');
  const [activeExample, setActiveExample] =
    useState<QuickstartExampleTabId>('decomposition');

  useEffect(() => {
    const ex = searchParams.get('example');
    if (isQuickstartExampleTabId(ex)) {
      setActiveExample(ex);
    }
  }, [searchParams]);

  const selectExample = useCallback(
    (id: QuickstartExampleTabId) => {
      setActiveExample(id);
      const params = new URLSearchParams(searchParams.toString());
      params.set('example', id);
      router.replace(`${pathname}?${params.toString()}#code-examples`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams]
  );

  const meta = EXAMPLE_META[activeExample];

  return (
    <section id="code-examples" className="scroll-mt-24">
      <div className="flex items-start gap-4 mb-8">
        <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
          5
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold text-zinc-100 mb-2">
            Longer examples
          </h2>
          <p className="text-zinc-400 mb-6">
            The repo&apos;s{' '}
            <a
              href="https://github.com/Cerebellum-Archive/RiskModels_API/tree/main/examples/python"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              examples/python
            </a>{' '}
            scripts mirror raw REST; for shorter, agent-friendly code prefer{' '}
            <a
              href="https://github.com/Cerebellum-Archive/RiskModels_API/tree/main/sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              riskmodels-py
            </a>
            . Same four themes as{' '}
            <Link
              href="/#what-you-can-do"
              className="font-semibold text-zinc-300 underline-offset-2 hover:text-primary hover:underline"
            >
              What you can do
            </Link>{' '}
            on the home page — each maps to a core endpoint. Share a tab with{' '}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-300">
              ?example=
            </code>{' '}
            in the URL.
          </p>

          <div className="flex flex-wrap gap-2 mb-8">
            {EXAMPLE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => selectExample(id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeExample === id
                    ? 'bg-primary text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {EXAMPLE_META[id].label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-8 border-b border-zinc-800">
            <button
              type="button"
              onClick={() => setActiveTab('python')}
              className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
                activeTab === 'python'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Python
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('typescript')}
              className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
                activeTab === 'typescript'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              TypeScript
            </button>
          </div>

          <div className="mb-6">
            <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg">
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">
                {meta.title}
              </h3>
              <p className="text-sm text-zinc-400 mb-2">{meta.body}</p>
              <p className="text-xs text-zinc-500 font-mono">{meta.endpoint}</p>
            </div>
          </div>

          <CodeBlock
            code={EXAMPLES[activeTab][activeExample]}
            language={activeTab === 'python' ? 'python' : 'typescript'}
            filename={`${FILENAME[activeExample]}.${activeTab === 'python' ? 'py' : 'ts'}`}
          />

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg">
              <h3 className="text-lg font-semibold text-zinc-100 mb-3">
                Repo examples
              </h3>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li>
                  <a
                    href="https://github.com/Cerebellum-Archive/RiskModels_API/tree/main/examples/python"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Python examples →
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/Cerebellum-Archive/RiskModels_API/tree/main/examples/typescript"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    TypeScript examples →
                  </a>
                </li>
              </ul>
            </div>

            <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg">
              <h3 className="text-lg font-semibold text-zinc-100 mb-3">
                Need more detail?
              </h3>
              <p className="text-sm text-zinc-400 mb-3">
                Full API docs, auth modes, and field definitions.
              </p>
              <Link
                href="/docs/api"
                className="inline-block px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-md transition-colors"
              >
                View docs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
