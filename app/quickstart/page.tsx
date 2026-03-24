import { Suspense } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import QuickstartCodeExamples from '@/components/QuickstartCodeExamples';
import { ArrowRight } from 'lucide-react';

const pythonSdkExample = `from riskmodels import RiskModelsClient, to_llm_context

# Auto-discover from environment (RISKMODELS_API_KEY)
client = RiskModelsClient.from_env()

# Analyze portfolio with semantic fields and ticker normalization
pa = client.analyze({"NVDA": 0.4, "GOOGL": 0.6})  # GOOGL→GOOG aliased

# Holdings-weighted hedge ratios (pre-aggregated client-side)
hr = pa.portfolio_hedge_ratios
print(f"Market HR:  {hr['l3_market_hr']:.2f}")
print(f"Sector HR:  {hr['l3_sector_hr']:.2f}")

# LLM-ready context: includes lineage, legend, semantic cheatsheet
print(to_llm_context(pa))`;

const pythonRawExample = `import requests

API_KEY  = "rm_agent_live_..."
BASE_URL = "https://riskmodels.app/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# Get latest metrics for NVDA (V3: fields nest under "metrics")
resp = requests.get(f"{BASE_URL}/metrics/NVDA", headers=HEADERS)
body = resp.json()
m = body["metrics"]  # Wire keys (l3_mkt_hr) need manual remap

print(f"Residual Risk:  {(m.get('l3_res_er') or 0):.1%}")
print(f"Market Hedge:   {(m.get('l3_mkt_hr') or 0):.2f}")
print(f"Vol (23d):      {(m.get('vol_23d') or 0):.1%}")

# Note: No ticker alias detection, no semantic normalization, no validation`;

const typescriptExample = `const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.app/api";

const resp = await fetch(\`\${BASE_URL}/metrics/NVDA\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` }
});

const body = await resp.json();
const m = body.metrics;

console.log(\`Residual Risk:  \${((m.l3_res_er ?? 0) * 100).toFixed(1)}%\`);
console.log(\`Market Hedge:   \${(m.l3_mkt_hr ?? 0).toFixed(2)}\`);
console.log(\`Vol (23d):      \${((m.vol_23d ?? 0) * 100).toFixed(1)}%\`);`;

const curlExample = `curl -X GET "https://riskmodels.app/api/metrics/NVDA" \\
  -H "Authorization: Bearer rm_agent_live_..."`;

const agenticCliExample = `# Agentic workflow — delegate tasks to the RiskModels agent
# Install the CLI first: npm install -g riskmodels-cli

# Configure your API key
$ riskmodels config set apiKey rm_live_...

# Delegate portfolio decomposition
$ riskmodels agent decompose --portfolio ./positions.json

# Set up drift monitoring
$ riskmodels agent monitor --portfolio ./positions.json --threshold 2.0

# Get pre-trade risk check
$ riskmodels agent check --trade ./new_trade.json --portfolio ./current.json`;

const agenticConfigExample = `# Agentic configuration file (~/.riskmodels/agent-config.yaml)
# Define your factor targets and alert thresholds

targets:
  market_beta: 0.85
  momentum: 0.10
  size: -0.05

alert_thresholds:
  sigma: 2.0
  min_position_usd: 10000

webhooks:
  drift_alert: https://your-app.com/webhooks/drift
  rebalance_trigger: https://your-app.com/webhooks/rebalance`;

export default function QuickstartPage() {
  return (
    <div className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-zinc-100 mb-4">Quickstart</h1>
          <p className="text-lg text-zinc-400">
            Get an API key, install the Python SDK, run your first portfolio analysis — all under 60 seconds.
          </p>
        </div>

        {/* Step 1 */}
        <div className="mb-12">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
              1
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-zinc-100 mb-3">Get Your API Key</h2>
              <p className="text-zinc-400 mb-4">
                Sign up and generate your API key — takes under a minute. No password needed.
              </p>
              <Link
                href="/get-key"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors"
              >
                Get API Key
                <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="mb-12">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
              2
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-zinc-100 mb-3">Install the SDK</h2>
              <p className="text-zinc-400 mb-4">
                The Python SDK handles ticker resolution, semantic field names, validation, and LLM context formatting. Install with the xarray extra for multi-dimensional portfolio math.
              </p>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2">Python SDK (Recommended)</h3>
                  <CodeBlock
                    code="pip install riskmodels-py[xarray]"
                    language="bash"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2">Raw REST (Python)</h3>
                  <CodeBlock
                    code="pip install requests pandas pyarrow"
                    language="bash"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2">TypeScript / Node.js</h3>
                  <CodeBlock
                    code="npm install node-fetch
# or use native fetch in Node 18+"
                    language="bash"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="mb-12">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
              3
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-zinc-100 mb-3">Make Your First Request</h2>
              <p className="text-zinc-400 mb-6">
                Analyze portfolios or fetch risk metrics for any ticker (e.g., NVDA, AAPL, MSFT). The SDK auto-normalizes ticker aliases and wire field names.
              </p>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Python SDK (Recommended)</h3>
                  <CodeBlock
                    code={pythonSdkExample}
                    language="python"
                    filename="quickstart_sdk.py"
                  />
                  <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
                    The SDK emits <code className="text-zinc-400 bg-zinc-800 px-1 rounded">ValidationWarning</code> for ticker aliases (GOOGL→GOOG) and returns semantic column names (<code className="text-zinc-400 bg-zinc-800 px-1 rounded">l3_market_hr</code> instead of raw <code className="text-zinc-400 bg-zinc-800 px-1 rounded">l3_mkt_hr</code>). See <Link href="/docs/api" className="text-blue-400 hover:text-blue-300 underline">Agent-Native Helpers</Link> for all SDK features.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Raw REST (Python)</h3>
                  <CodeBlock
                    code={pythonRawExample}
                    language="python"
                    filename="quickstart_raw.py"
                  />
                  <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
                    Raw REST requires manual parsing of nested <code className="text-zinc-400 bg-zinc-800 px-1 rounded">body[&quot;metrics&quot;]</code> objects, no ticker alias detection, and OAuth token rotation logic for production use. The SDK handles all of this.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">TypeScript</h3>
                  <CodeBlock
                    code={typescriptExample}
                    language="typescript"
                    filename="quickstart.ts"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">cURL</h3>
                  <CodeBlock
                    code={curlExample}
                    language="bash"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 4: Agentic API */}
        <div className="mb-12">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white font-bold">
              4
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-2xl font-bold text-zinc-100">Try the Agentic CLI</h2>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                  Beta
                </span>
              </div>
              <p className="text-zinc-400 mb-6">
                Instead of constructing API queries, delegate tasks to the RiskModels agent via CLI.
                Configure once, then let the agent monitor, analyze, and alert on your portfolio.
              </p>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Install CLI</h3>
                  <CodeBlock
                    code="npm install -g riskmodels-cli"
                    language="bash"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">CLI Commands</h3>
                  <CodeBlock
                    code={agenticCliExample}
                    language="bash"
                    filename="agentic-commands.sh"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Configuration</h3>
                  <CodeBlock
                    code={agenticConfigExample}
                    language="yaml"
                    filename="~/.riskmodels/agent-config.yaml"
                  />
                </div>
              </div>

              <div className="mt-6 p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
                <p className="text-sm text-zinc-400">
                  <strong className="text-zinc-300">Available agent tasks:</strong>{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">decompose</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">monitor</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">check</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">rebalance</code>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-12">
          <Suspense
            fallback={
              <div className="animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-sm text-zinc-500">
                Loading examples…
              </div>
            }
          >
            <QuickstartCodeExamples />
          </Suspense>
        </div>

        {/* Step 6 */}
        <div className="mb-12">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
              5
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-zinc-100 mb-3">Explore more</h2>
              <p className="text-zinc-400 mb-6">
                Now that you have your first request working, explore the full API capabilities.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link
                  href="/api-reference"
                  className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-primary/50 transition-colors group"
                >
                  <h3 className="text-lg font-semibold text-zinc-100 mb-2 group-hover:text-primary transition-colors">
                    API Reference
                  </h3>
                  <p className="text-sm text-zinc-400">
                    Complete OpenAPI specification with all endpoints and schemas
                  </p>
                </Link>

                <Link
                  href="/docs/api"
                  className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-primary/50 transition-colors group"
                >
                  <h3 className="text-lg font-semibold text-zinc-100 mb-2 group-hover:text-primary transition-colors">
                    Documentation
                  </h3>
                  <p className="text-sm text-zinc-400">
                    In-depth guides for all API features and concepts
                  </p>
                </Link>

                <Link
                  href="/docs/authentication"
                  className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-primary/50 transition-colors group"
                >
                  <h3 className="text-lg font-semibold text-zinc-100 mb-2 group-hover:text-primary transition-colors">
                    Authentication
                  </h3>
                  <p className="text-sm text-zinc-400">
                    OAuth2, Bearer tokens, and AI agent provisioning
                  </p>
                </Link>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
