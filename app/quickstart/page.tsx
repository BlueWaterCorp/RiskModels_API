import { Suspense } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import QuickstartCodeExamples from '@/components/QuickstartCodeExamples';
import { ArrowRight } from 'lucide-react';

const pythonExample = `import requests

API_KEY  = "rm_agent_live_..."
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# Get latest metrics for NVDA (V3: fields live under "metrics")
resp = requests.get(f"{BASE_URL}/metrics/NVDA", headers=HEADERS)
body = resp.json()
m = body["metrics"]

print(f"Residual Risk:  {(m.get('l3_res_er') or 0):.1%}")
print(f"Market Hedge:   {(m.get('l3_mkt_hr') or 0):.2f}")
print(f"Vol (23d):      {(m.get('vol_23d') or 0):.1%}")`;

const typescriptExample = `const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.net/api";

const resp = await fetch(\`\${BASE_URL}/metrics/NVDA\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` }
});

const body = await resp.json();
const m = body.metrics;

console.log(\`Residual Risk:  \${((m.l3_res_er ?? 0) * 100).toFixed(1)}%\`);
console.log(\`Market Hedge:   \${(m.l3_mkt_hr ?? 0).toFixed(2)}\`);
console.log(\`Vol (23d):      \${((m.vol_23d ?? 0) * 100).toFixed(1)}%\`);`;

const curlExample = `curl -X GET "https://riskmodels.net/api/metrics/NVDA" \\
  -H "Authorization: Bearer rm_agent_live_..."`;

export default function QuickstartPage() {
  return (
    <div className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-zinc-100 mb-4">Quickstart</h1>
          <p className="text-lg text-zinc-400">
            Get an API key, run your first request, then use longer Python and
            TypeScript examples—all in one place.
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

        {/* Step 5 */}
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
