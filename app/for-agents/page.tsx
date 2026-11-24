import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeExhibit } from '@/components/site/CodeExhibit';
import { SectionHead } from '@/components/site/SectionHead';
import { EXECUTED_ON } from '@/lib/site/examples';

export const metadata: Metadata = {
  alternates: { canonical: '/for-agents' },
  title: 'For AI agents',
  description:
    'What an agent, or the team approving one, needs to find and call RiskModels: machine-readable manifests, the price of each call in the response headers, and the model version and data date on every answer.',
};

const DISCOVERY: Array<[string, string, string]> = [
  ['Capability manifest', '/.well-known/agent-manifest.json', 'Capabilities, prices and links to the other documents.'],
  ['OpenAPI specification', '/openapi.json', 'The REST contract, with a price on each endpoint.'],
  ['MCP manifest', '/.well-known/mcp.json', 'Hosted connector endpoints, tools and sign-in.'],
  ['llms.txt', '/llms.txt', 'A short index of links; the full reference is /llms-full.txt.'],
  ['Data handling disclosure', '/.well-known/agentic-disclosure.json', 'Retention, storage and training policy.'],
];

const RESPONSE_FACTS: Array<[string, string]> = [
  ['Model version', 'x-risk-model-version header and _metadata.model_version'],
  ['Data date', 'x-data-as-of header and _metadata.data_as_of'],
  ['Factor set', 'x-factor-set-id header and _metadata.factor_set_id'],
  ['Price of the call', 'x-api-cost-usd header'],
  ['Request id', 'x-request-id header and _agent.request_id'],
  ['Rate limit', 'x-ratelimit-limit and x-ratelimit-remaining headers'],
];

const DECOMPOSE = `curl --fail-with-body -X POST "https://riskmodels.app/api/decompose" \\
  -H "Authorization: Bearer $RISKMODELS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ticker":"NVDA"}'`;

const TOOL_DEFS = `npm install -g riskmodels@latest
riskmodels manifest --format anthropic   # or: openai | zed`;

export default function ForAgentsPage() {
  return (
    <div className="rm-page pb-24">
      <header className="pb-14 pt-12 sm:pt-16">
        <p className="rm-label">For AI agents</p>
        <h1 className="rm-h1 mt-4 max-w-3xl">What an agent needs to find, call and cite RiskModels.</h1>
        <p className="rm-lede mt-6 max-w-2xl">
          The API returns a four-layer risk decomposition and ETF hedge ratios as JSON. Each response states
          the model version and data date it came from and the price of the call, so an answer built on it
          can be cited and reconciled to a bill.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/get-key" className="rm-btn">
            Get an API key
          </Link>
          <Link href="/docs/agent-integration" className="rm-btn-ghost">
            Connector setup
          </Link>
        </div>
      </header>

      <section className="rm-section" aria-labelledby="discovery">
        <SectionHead n="01" label="Discovery" title="Machine-readable entry points" id="discovery">
          <p>None of these needs a key.</p>
        </SectionHead>
        <div className="rm-scroll-x mt-8">
          <table className="rm-table min-w-[34rem]">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Path</th>
                <th scope="col">Contents</th>
              </tr>
            </thead>
            <tbody>
              {DISCOVERY.map(([name, href, body]) => (
                <tr key={href}>
                  <td>{name}</td>
                  <td>
                    <a href={href} className="rm-link rm-mono text-[13px]">
                      {href}
                    </a>
                  </td>
                  <td>{body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rm-section" aria-labelledby="call">
        <SectionHead n="02" label="First call" title="One request with a key" id="call">
          <p>
            Keys are Bearer tokens. A person gets one at{' '}
            <Link href="/get-key" className="rm-link">
              /get-key
            </Link>
            ; an agent can register itself with <code className="rm-mono">POST /api/auth/provision</code>,
            described in the{' '}
            <Link href="/docs/agent-integration" className="rm-link">
              integration guide
            </Link>
            .
          </p>
        </SectionHead>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <CodeExhibit
            caption="Decompose one stock"
            tabs={[
              {
                id: 'curl',
                label: 'curl',
                code: DECOMPOSE,
                note: `Returned 200 with exposure, hedge and hedge_levels blocks when run on ${EXECUTED_ON}.`,
              },
            ]}
          />
          <CodeExhibit
            caption="Tool definitions"
            tabs={[
              {
                id: 'cli',
                label: 'Command line',
                code: TOOL_DEFS,
                note: `Prints tool definitions for the named framework. Run on ${EXECUTED_ON}.`,
              },
            ]}
          />
        </div>
      </section>

      <section className="rm-section" aria-labelledby="response">
        <SectionHead n="03" label="Provenance" title="What every response states" id="response">
          <p>
            Read from the headers and body of a <code className="rm-mono">POST /api/decompose</code> response
            on {EXECUTED_ON}. History is served from 2010-12-08 for hedge ratios and from 2011-12-07 for
            variance shares; the{' '}
            <Link href="/docs/methodology" className="rm-link">
              methodology
            </Link>{' '}
            describes the model.
          </p>
        </SectionHead>
        <dl className="mt-8 border-t border-[var(--rm-ink)]">
          {RESPONSE_FACTS.map(([k, v]) => (
            <div key={k} className="grid gap-1 border-b border-rule py-3 sm:grid-cols-12 sm:gap-8">
              <dt className="text-[15px] font-medium text-ink sm:col-span-3">{k}</dt>
              <dd className="rm-mono text-[13px] text-ink-muted sm:col-span-9">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="rm-small mt-4">
          A request with too little credit returns 402. Prices are on the{' '}
          <Link href="/pricing" className="rm-link">
            pricing page
          </Link>{' '}
          and service health on the{' '}
          <Link href="/status" className="rm-link">
            status page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
