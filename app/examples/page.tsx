'use client';

import { useState } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';

const pythonQuickstart = `#!/usr/bin/env python3
"""
RiskModels API — Quickstart: Hedge a Single Stock

Fetches daily returns and rolling L1/L2/L3 hedge ratios for a ticker.
pip install requests pandas pyarrow
"""

API_KEY  = "rm_agent_live_..."
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

import requests
import pandas as pd

# Fetch hedge ratios for NVDA (1 year history)
ticker = "NVDA"
resp = requests.get(
    f"{BASE_URL}/ticker-returns",
    headers=HEADERS,
    params={"ticker": ticker, "years": 1}
)
resp.raise_for_status()
body = resp.json()

# Convert to DataFrame
df = pd.DataFrame(body["data"])
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values("date").reset_index(drop=True)

# Get latest hedge ratios
latest = df.iloc[-1]
meta = body["meta"]

print(f"Latest hedge ratios for {ticker}:")
print(f"  Market ETF: {meta['market_etf']}")
print(f"  L1 hedge:   {latest['l1']:.4f}")
print(f"  L2 hedge:   {latest['l2']:.4f}")
print(f"  L3 hedge:   {latest['l3']:.4f}")

# Cost and cache info
agent = body["_agent"]
print(f"Cost: \${agent['cost_usd']:.4f} | Cache: {agent['cache_status']}")`;

const typescriptQuickstart = `/**
 * RiskModels API — Quickstart (TypeScript)
 * npm install node-fetch (or use native fetch in Node 18+)
 */

const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.net/api";
const HEADERS  = { Authorization: \`Bearer \${API_KEY}\` };

interface TickerReturnsResponse {
  meta: {
    market_etf: string;
    sector_etf: string;
    subsector_etf: string;
  };
  data: Array<{
    date: string;
    stock: number;
    l1: number;
    l2: number;
    l3: number;
  }>;
  _agent: {
    cost_usd: number;
    cache_status: string;
    latency_ms: number;
  };
}

async function getHedgeRatios(ticker: string) {
  const url = new URL(\`\${BASE_URL}/ticker-returns\`);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("years", "1");

  const resp = await fetch(url.toString(), { headers: HEADERS });
  if (!resp.ok) throw new Error(\`API error: \${resp.status}\`);

  const body: TickerReturnsResponse = await resp.json();
  const sorted = [...body.data].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  console.log(\`Latest hedge ratios for \${ticker}:\`);
  console.log(\`  Market ETF: \${body.meta.market_etf}\`);
  console.log(\`  L1 hedge:   \${latest.l1.toFixed(4)}\`);
  console.log(\`  L2 hedge:   \${latest.l2.toFixed(4)}\`);
  console.log(\`  L3 hedge:   \${latest.l3.toFixed(4)}\`);
  console.log(\`  Cost: $\${body._agent.cost_usd.toFixed(4)}\`);
}

// Run
getHedgeRatios("NVDA");`;

const pythonBatch = `#!/usr/bin/env python3
"""
Portfolio batch analysis — analyze multiple tickers at once
"""
import requests

API_KEY  = "rm_agent_live_..."
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# Portfolio holdings
portfolio = [
    {"ticker": "AAPL", "position_usd": 50000},
    {"ticker": "MSFT", "position_usd": 75000},
    {"ticker": "NVDA", "position_usd": 100000},
]

# Batch request (cheaper per position)
tickers = [p["ticker"] for p in portfolio]
resp = requests.post(
    f"{BASE_URL}/batch/analyze",
    headers=HEADERS,
    json={"tickers": tickers}
)
resp.raise_for_status()
results = resp.json()

# Calculate hedge notionals
for holding in portfolio:
    ticker = holding["ticker"]
    position = holding["position_usd"]
    metrics = results["data"][ticker]
    
    spy_hedge = position * metrics["l3_market_hr"]
    sector_hedge = position * metrics["l3_sector_hr"]
    
    print(f"{ticker} (\${position:,})")
    print(f"  SPY hedge:    \${spy_hedge:,.0f}")
    print(f"  Sector hedge: \${sector_hedge:,.0f}")
    print(f"  Residual:     {metrics['l3_residual_er']:.1%}")
    print()

# Total cost
print(f"Total cost: \${results['_agent']['cost_usd']:.4f}")`;

const typescriptBatch = `/**
 * Portfolio batch analysis (TypeScript)
 */

const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.net/api";
const HEADERS  = { Authorization: \`Bearer \${API_KEY}\` };

interface Portfolio {
  ticker: string;
  position_usd: number;
}

async function analyzePortfolio(holdings: Portfolio[]) {
  const tickers = holdings.map(h => h.ticker);
  
  const resp = await fetch(\`\${BASE_URL}/batch/analyze\`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers })
  });
  
  if (!resp.ok) throw new Error(\`Batch error: \${resp.status}\`);
  const results = await resp.json();
  
  console.log("Portfolio hedge analysis:\\n");
  
  for (const holding of holdings) {
    const metrics = results.data[holding.ticker];
    const spyHedge = holding.position_usd * metrics.l3_market_hr;
    const sectorHedge = holding.position_usd * metrics.l3_sector_hr;
    
    console.log(\`\${holding.ticker} ($\${holding.position_usd.toLocaleString()})\`);
    console.log(\`  SPY hedge:    $\${spyHedge.toFixed(0)}\`);
    console.log(\`  Sector hedge: $\${sectorHedge.toFixed(0)}\`);
    console.log(\`  Residual:     \${(metrics.l3_residual_er * 100).toFixed(1)}%\\n\`);
  }
  
  console.log(\`Total cost: $\${results._agent.cost_usd.toFixed(4)}\`);
}

// Run
analyzePortfolio([
  { ticker: "AAPL", position_usd: 50000 },
  { ticker: "MSFT", position_usd: 75000 },
  { ticker: "NVDA", position_usd: 100000 },
]);`;

export default function ExamplesPage() {
  const [activeTab, setActiveTab] = useState<'python' | 'typescript'>('python');
  const [activeExample, setActiveExample] = useState<'quickstart' | 'batch'>('quickstart');

  const examples = {
    python: {
      quickstart: pythonQuickstart,
      batch: pythonBatch,
    },
    typescript: {
      quickstart: typescriptQuickstart,
      batch: typescriptBatch,
    },
  };

  return (
    <div className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-zinc-100 mb-4">Code Examples</h1>
          <p className="text-lg text-zinc-400">
            Production-ready examples in Python and TypeScript
          </p>
        </div>

        {/* Language tabs */}
        <div className="flex gap-2 mb-8 border-b border-zinc-800">
          <button
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

        {/* Example selector */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveExample('quickstart')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeExample === 'quickstart'
                ? 'bg-primary text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Quickstart
          </button>
          <button
            onClick={() => setActiveExample('batch')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeExample === 'batch'
                ? 'bg-primary text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Portfolio Batch
          </button>
        </div>

        {/* Example descriptions */}
        <div className="mb-6">
          {activeExample === 'quickstart' && (
            <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg">
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">
                Single Stock Quickstart
              </h3>
              <p className="text-sm text-zinc-400">
                Fetch daily returns and rolling L1/L2/L3 hedge ratios for a single ticker.
                The latest row gives the current hedge ratio to use for live trading.
              </p>
            </div>
          )}
          {activeExample === 'batch' && (
            <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg">
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">
                Portfolio Batch Analysis
              </h3>
              <p className="text-sm text-zinc-400">
                Analyze multiple tickers at once (up to 100). 25% cheaper per position.
                Calculate hedge notionals for each holding in your portfolio.
              </p>
            </div>
          )}
        </div>

        {/* Code block */}
        <CodeBlock
          code={examples[activeTab][activeExample]}
          language={activeTab === 'python' ? 'python' : 'typescript'}
          filename={`${activeExample}.${activeTab === 'python' ? 'py' : 'ts'}`}
        />

        {/* Additional resources */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg">
            <h3 className="text-lg font-semibold text-zinc-100 mb-3">More Examples</h3>
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
            <h3 className="text-lg font-semibold text-zinc-100 mb-3">Need Help?</h3>
            <p className="text-sm text-zinc-400 mb-3">
              Check out the full documentation or contact support if you need assistance.
            </p>
            <Link
              href="/docs/api"
              className="inline-block px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-md transition-colors"
            >
              View Docs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
