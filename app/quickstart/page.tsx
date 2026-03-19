import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import { CheckCircle2, ArrowRight } from 'lucide-react';

const pythonExample = `import requests

API_KEY  = "rm_agent_live_..."
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# Get latest metrics for NVDA
resp = requests.get(f"{BASE_URL}/metrics/NVDA", headers=HEADERS)
metrics = resp.json()

print(f"Residual Risk:  {metrics['l3_residual_er']:.1%}")
print(f"Market Hedge:   {metrics['l3_market_hr']:.2f}")
print(f"Volatility:     {metrics['volatility']:.1%}")`;

const typescriptExample = `const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.net/api";

const resp = await fetch(\`\${BASE_URL}/metrics/NVDA\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` }
});

const metrics = await resp.json();

console.log(\`Residual Risk:  \${(metrics.l3_residual_er * 100).toFixed(1)}%\`);
console.log(\`Market Hedge:   \${metrics.l3_market_hr.toFixed(2)}\`);
console.log(\`Volatility:     \${(metrics.volatility * 100).toFixed(1)}%\`);`;

const curlExample = `curl -X GET "https://riskmodels.net/api/metrics/NVDA" \\
  -H "Authorization: Bearer rm_agent_live_..."`;

export default function QuickstartPage() {
  return (
    <div className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-zinc-100 mb-4">Quickstart Guide</h1>
          <p className="text-lg text-zinc-400">
            Get started with the RiskModels API in under 5 minutes
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
              <h2 className="text-2xl font-bold text-zinc-100 mb-3">Install Dependencies</h2>
              <p className="text-zinc-400 mb-4">
                Choose your language and install the required packages.
              </p>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2">Python</h3>
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
                Fetch risk metrics for any ticker in the universe (e.g., NVDA, AAPL, MSFT).
              </p>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3">Python</h3>
                  <CodeBlock
                    code={pythonExample}
                    language="python"
                    filename="quickstart.py"
                  />
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

        {/* Step 4 */}
        <div className="mb-12">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
              4
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-zinc-100 mb-3">Explore More</h2>
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
                  href="/examples"
                  className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-primary/50 transition-colors group"
                >
                  <h3 className="text-lg font-semibold text-zinc-100 mb-2 group-hover:text-primary transition-colors">
                    Code Examples
                  </h3>
                  <p className="text-sm text-zinc-400">
                    Production-ready examples for common use cases
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

        {/* Key Features */}
        <div className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-lg">
          <h3 className="text-xl font-bold text-zinc-100 mb-6">What You Can Do</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-primary flex-shrink-0 mt-1" size={20} />
              <div>
                <h4 className="font-semibold text-zinc-100">Daily Factor Decompositions</h4>
                <p className="text-sm text-zinc-400">Market, sector, subsector explained risk</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-primary flex-shrink-0 mt-1" size={20} />
              <div>
                <h4 className="font-semibold text-zinc-100">Hedge Ratios (L1/L2/L3)</h4>
                <p className="text-sm text-zinc-400">Dollar-denominated ETF hedge amounts</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-primary flex-shrink-0 mt-1" size={20} />
              <div>
                <h4 className="font-semibold text-zinc-100">Historical Time Series</h4>
                <p className="text-sm text-zinc-400">15+ years of rolling hedge ratios</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-primary flex-shrink-0 mt-1" size={20} />
              <div>
                <h4 className="font-semibold text-zinc-100">Batch Analysis</h4>
                <p className="text-sm text-zinc-400">Analyze up to 100 tickers at once</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
