import { Suspense } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import QuickstartCodeExamples from '@/components/QuickstartCodeExamples';
import QuickstartDemoKey from '@/components/QuickstartDemoKey';
import { ArrowRight } from 'lucide-react';

const pythonSdkSingleTicker = `from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()  # RISKMODELS_API_KEY from environment

# as_dataframe=True attaches metadata (ERM3 legend, semantic cheatsheet)
df = client.get_metrics("NVDA", as_dataframe=True)

print(f"Market Hedge Ratio: {df['l3_market_hr'].iloc[0]:.2f}")
print(f"Residual Risk (Idiosyncratic): {df['l3_residual_er'].iloc[0]:.1%}")`;

const pythonSdkPortfolio = `from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()

portfolio = {
    "AAPL": 0.4,
    "MSFT": 0.3,
    "NVDA": 0.2,
    "GOOGL": 0.1,
}

# analyze is an alias for analyze_portfolio; GOOGL may resolve to GOOG
pa = client.analyze(portfolio)

print("Portfolio-Level L3 Hedge Ratios:")
for key, val in pa.portfolio_hedge_ratios.items():
    v = f"{val:.4f}" if val is not None else "n/a"
    print(f"{key}: {v}")`;

const pythonSdkDataset = `from riskmodels import RiskModelsClient

# pip install riskmodels-py[xarray] — builds Ticker × Date × Metric cube
client = RiskModelsClient.from_env()

ds = client.get_dataset(["AAPL", "TSLA", "META"], years=2)

meta_sector_hr = ds.sel(ticker="META")["l3_sector_hr"]
meta_sector_hr.plot()`;

const pythonSdkLlmContext = `from riskmodels import RiskModelsClient, to_llm_context

client = RiskModelsClient.from_env()
pa = client.analyze({"NVDA": 0.5, "AMD": 0.5})

# Markdown tables, lineage, ERM3 legend — ready for LLM prompts
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

const agenticCliExample = `# riskmodels-cli — install: npm install -g riskmodels-cli

# API key (billed mode; default base URL https://riskmodels.app)
riskmodels config set apiKey rm_agent_live_...

# Read-only SQL against your account (see /api/cli/query)
riskmodels query "SELECT ticker, company_name FROM ticker_metadata LIMIT 5"

# Account balance
riskmodels balance

# Static tool manifest for agents (no auth)
riskmodels manifest --format anthropic

# Portfolio automation: use REST POST /api/batch/analyze, Python SDK, or MCP discovery + HTTP — not via agent subcommands yet
riskmodels agent decompose --help   # placeholder; see CLI README`;

const agenticConfigExample = `# CLI stores settings in ~/.config/riskmodels/config.json
# Example keys (use "riskmodels config init" or "riskmodels config set"):
#
# Billed mode:
#   apiKey      — rm_agent_* key
#   apiBaseUrl  — https://riskmodels.app (optional)
#
# Direct Supabase dev mode:
#   supabaseUrl, serviceRoleKey — see archive/CLI_COMMAND_TESTING.md`;

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
              <QuickstartDemoKey />
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
                  <p className="text-sm text-zinc-500 mt-2">
                    <a
                      href="https://pypi.org/project/riskmodels-py/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      PyPI
                    </a>{' '}
                    — package <code className="text-zinc-400 bg-zinc-800 px-1 rounded">riskmodels-py</code>
                  </p>
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

              <div className="space-y-8">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Python SDK (Recommended)</h3>
                  <p className="text-sm text-zinc-400 mb-4">
                    Four common patterns — each uses{' '}
                    <code className="text-zinc-300 bg-zinc-800 px-1 rounded">riskmodels-py</code> instead of hand-rolling REST,
                    ticker cleanup, and field renaming.
                  </p>

                  <div className="space-y-6">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                        1 — Hedge a single stock (alias resolution)
                      </h4>
                      <CodeBlock
                        code={pythonSdkSingleTicker}
                        language="python"
                        filename="sdk_single_ticker.py"
                      />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                        2 — Analyze a weighted portfolio
                      </h4>
                      <CodeBlock
                        code={pythonSdkPortfolio}
                        language="python"
                        filename="sdk_portfolio.py"
                      />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                        3 — Build a multi-dimensional factor cube
                      </h4>
                      <CodeBlock
                        code={pythonSdkDataset}
                        language="python"
                        filename="sdk_dataset.py"
                      />
                      <p className="mt-2 text-xs text-zinc-500">
                        Requires the{' '}
                        <code className="text-zinc-400 bg-zinc-800 px-1 rounded">[xarray]</code> extra (see Install the SDK).
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                        4 — Generate LLM-ready context
                      </h4>
                      <CodeBlock
                        code={pythonSdkLlmContext}
                        language="python"
                        filename="sdk_llm_context.py"
                      />
                    </div>
                  </div>

                  <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-800">
                    <table className="w-full min-w-[28rem] text-sm text-left">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/80">
                          <th className="py-3 px-4 font-semibold text-zinc-300">Feature</th>
                          <th className="py-3 px-4 font-semibold text-zinc-400">Raw requests (example scripts)</th>
                          <th className="py-3 px-4 font-semibold text-primary">RiskModels SDK</th>
                        </tr>
                      </thead>
                      <tbody className="text-zinc-400">
                        <tr className="border-b border-zinc-800/80">
                          <td className="py-3 px-4 text-zinc-300">Ticker cleanup</td>
                          <td className="py-3 px-4">Manual ticker.upper()</td>
                          <td className="py-3 px-4">Automatic (e.g. GOOGL → GOOG)</td>
                        </tr>
                        <tr className="border-b border-zinc-800/80">
                          <td className="py-3 px-4 text-zinc-300">Field names</td>
                          <td className="py-3 px-4">Wire keys (l3_res_er, l3_mkt_hr)</td>
                          <td className="py-3 px-4">Semantic names (l3_residual_er, l3_market_hr)</td>
                        </tr>
                        <tr className="border-b border-zinc-800/80">
                          <td className="py-3 px-4 text-zinc-300">Validation</td>
                          <td className="py-3 px-4">None</td>
                          <td className="py-3 px-4">Warns on ER sum / HR sign issues (configurable)</td>
                        </tr>
                        <tr>
                          <td className="py-3 px-4 text-zinc-300">Context for agents</td>
                          <td className="py-3 px-4">Raw JSON</td>
                          <td className="py-3 px-4">Markdown tables + ERM3 legend via to_llm_context</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-6 text-sm text-zinc-400">
                    <strong className="text-zinc-300">Production auth:</strong> set{' '}
                    <code className="text-zinc-300 bg-zinc-800 px-1 rounded">RISKMODELS_CLIENT_ID</code> and{' '}
                    <code className="text-zinc-300 bg-zinc-800 px-1 rounded">RISKMODELS_CLIENT_SECRET</code>, then{' '}
                    <code className="text-zinc-300 bg-zinc-800 px-1 rounded">RiskModelsClient.from_env()</code> — the SDK
                    refreshes OAuth2 client-credentials tokens. Full flow:{' '}
                    <Link href="/docs/authentication" className="text-primary hover:underline">
                      Authentication guide
                    </Link>
                    .
                  </p>

                  <p className="mt-4 text-xs text-zinc-500 leading-relaxed">
                    The SDK emits <code className="text-zinc-400 bg-zinc-800 px-1 rounded">ValidationWarning</code> for
                    ticker aliases (GOOGL→GOOG) and returns semantic column names (
                    <code className="text-zinc-400 bg-zinc-800 px-1 rounded">l3_market_hr</code> instead of raw{' '}
                    <code className="text-zinc-400 bg-zinc-800 px-1 rounded">l3_mkt_hr</code>). See{' '}
                    <Link href="/docs/api" className="text-blue-400 hover:text-blue-300 underline">
                      Agent-Native Helpers
                    </Link>{' '}
                    for all SDK features.
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
                <h2 className="text-2xl font-bold text-zinc-100">Try the CLI (`riskmodels-cli`)</h2>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                  Beta
                </span>
              </div>
              <p className="text-zinc-400 mb-6">
                Global install gives you <code className="text-zinc-300">riskmodels</code>: config, billed SQL{' '}
                <code className="text-zinc-300">query</code>, <code className="text-zinc-300">balance</code>, and{' '}
                <code className="text-zinc-300">manifest</code> for agents. Portfolio decomposition and drift monitoring
                are available via the REST API and Python SDK; CLI <code className="text-zinc-300">agent</code> commands are placeholders.
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
                    language="bash"
                    filename="config-hints.txt"
                  />
                </div>
              </div>

              <div className="mt-6 p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
                <p className="text-sm text-zinc-400">
                  <strong className="text-zinc-300">CLI commands shipped today:</strong>{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">config</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">query</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">schema</code> (direct mode),{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">balance</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">manifest</code>,{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">agent</code> (stubs). For full portfolio flows use{' '}
                  <Link href="/docs/api" className="text-primary hover:underline">API docs</Link> or{' '}
                  <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">riskmodels-py</code>.
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
              6
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
