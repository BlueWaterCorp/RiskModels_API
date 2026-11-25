import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeExhibit } from '@/components/site/CodeExhibit';
import { ConnectorSteps } from '@/components/site/ConnectorSteps';
import { SectionHead } from '@/components/site/SectionHead';
import { getCapabilityById } from '@/lib/agent/capabilities';
import {
  AGENT_INSTALL,
  CLI_FIRST_CALL,
  CLI_INSTALL,
  CURL_FIRST_CALL,
  EXECUTED_ON,
  PYTHON_FIRST_CALL,
  PYTHON_FIRST_CALL_OUTPUT,
  PYTHON_INSTALL,
} from '@/lib/site/examples';

export const metadata: Metadata = {
  alternates: { canonical: '/installation' },
  title: 'Quickstart',
  description: 'Make a first RiskModels API request with curl, Python, the command line or an AI assistant.',
};

export default function InstallationPage() {
  const price = getCapabilityById('metrics')?.pricing.cost_usd;
  const cost = price != null ? `$${price}` : 'the listed price';
  return (
    <div className="rm-page pb-12">
      <header className="pb-4 pt-8 sm:pt-10">
        <p className="rm-label">Quickstart</p>
        <h1 className="rm-h1 mt-4 max-w-3xl">Make a first request</h1>
        <p className="rm-lede mt-4 max-w-2xl">
          Every route below returns the same data: the risk decomposition and ETF hedge ratios for one stock.
          Each needs an API key, and the request costs {cost} against the $20 of credit a new key carries.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/get-key" className="rm-btn">
            Get an API key
          </Link>
          <Link href="/api-reference" className="rm-btn-ghost">
            Read the reference
          </Link>
        </div>
        <p className="rm-small mt-4">
          The examples on this page were run against production on {EXECUTED_ON}.
        </p>
      </header>

      <section className="rm-section" aria-labelledby="http">
        <SectionHead n="01" label="HTTP" title="curl" id="http">
          <p>
            Set <code className="rm-mono">RISKMODELS_API_KEY</code> in the shell, then send one request. The
            response is JSON; the fields are defined in the{' '}
            <Link href="/api-reference" className="rm-link">
              API reference
            </Link>
            .
          </p>
        </SectionHead>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <CodeExhibit tabs={[{ id: 'set', label: 'Set the key', code: 'export RISKMODELS_API_KEY=rm_agent_...' }]} />
          <CodeExhibit tabs={[{ id: 'curl', label: 'Request', code: CURL_FIRST_CALL }]} />
        </div>
      </section>

      <section className="rm-section" aria-labelledby="python">
        <SectionHead n="02" label="Python" title="Python SDK" id="python">
          <p>
            The SDK returns one row with readable field names:{' '}
            <code className="rm-mono">l3_residual_er</code> is the residual share of variance and{' '}
            <code className="rm-mono">l3_market_hr</code> the market hedge ratio.
          </p>
        </SectionHead>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <CodeExhibit tabs={[{ id: 'install', label: 'Install', code: PYTHON_INSTALL }]} />
          <CodeExhibit
            tabs={[
              {
                id: 'call',
                label: 'Request',
                code: PYTHON_FIRST_CALL,
                note: `Printed ${PYTHON_FIRST_CALL_OUTPUT} on ${EXECUTED_ON}.`,
              },
            ]}
          />
        </div>
      </section>

      <section className="rm-section" aria-labelledby="cli">
        <SectionHead n="03" label="Command line" title="Command line" id="cli">
          <p>
            <code className="rm-mono">riskmodels doctor</code> checks Node, the key and the assistant
            configuration on the machine. <code className="rm-mono">decompose</code> prints the four layers as
            JSON. More commands are on the{' '}
            <Link href="/cli" className="rm-link">
              command line page
            </Link>
            .
          </p>
        </SectionHead>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <CodeExhibit tabs={[{ id: 'install', label: 'Install', code: CLI_INSTALL }]} />
          <CodeExhibit tabs={[{ id: 'call', label: 'Request', code: CLI_FIRST_CALL }]} />
        </div>
      </section>

      <section className="rm-section" aria-labelledby="assistant">
        <SectionHead n="04" label="Assistants" title="AI assistant" id="assistant">
          <p>
            The hosted connector needs no key: sign in once in the browser. For a local setup with a key, the
            installer writes the server entry into the assistant configurations it finds.
          </p>
        </SectionHead>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <ConnectorSteps />
          <div className="min-w-0">
            <CodeExhibit tabs={[{ id: 'install', label: 'Local install, with a key', code: AGENT_INSTALL }]} />
            <p className="rm-small mt-3">
              Other clients and addresses are on the{' '}
              <Link href="/docs/agent-integration" className="rm-link">
                connector setup page
              </Link>
              . Machine-readable instructions for agents are in{' '}
              <a href="/llms.txt" className="rm-link">
                llms.txt
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
