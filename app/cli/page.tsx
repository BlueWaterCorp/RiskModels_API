import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeExhibit } from '@/components/site/CodeExhibit';
import { SectionHead } from '@/components/site/SectionHead';
import { CLI_INSTALL, EXECUTED_ON } from '@/lib/site/examples';

export const metadata: Metadata = {
  alternates: { canonical: '/cli' },
  title: 'Command line',
  description: 'Install the RiskModels command line and run a decomposition, a batch and a cost estimate.',
};

const COMMANDS: { command: string; returns: string }[] = [
  { command: 'riskmodels doctor', returns: 'Checks Node, the key and assistant configuration. No request is billed.' },
  { command: 'riskmodels health', returns: 'Service status from /api/health. Needs no key.' },
  { command: 'riskmodels decompose NVDA', returns: 'The four risk layers and the ETF hedge for one stock, as JSON.' },
  {
    command: 'riskmodels agent decompose --tickers AAPL,NVDA',
    returns: 'The same for several stocks in one batch request, charged per position.',
  },
  {
    command: `riskmodels estimate --endpoint ticker-returns --params-json '{"ticker":"NVDA","years":5}'`,
    returns: 'The price of a request before it is sent. This one returned $0.06.',
  },
  { command: 'riskmodels balance', returns: 'Remaining credit on the account that owns the key.' },
  { command: 'riskmodels manifest --format anthropic', returns: 'Tool definitions for an agent framework (also openai, zed).' },
];

export default function CliPage() {
  return (
    <div className="rm-page pb-24">
      <header className="pb-14 pt-12 sm:pt-16">
        <p className="rm-label">Command line</p>
        <h1 className="rm-h1 mt-4 max-w-3xl">The API from a terminal</h1>
        <p className="rm-lede mt-6 max-w-2xl">
          One npm package wraps the REST endpoints. Output is JSON, so it pipes into other tools.
        </p>
      </header>

      <section className="rm-section" aria-labelledby="install">
        <SectionHead n="01" label="Install" title="Install and check" id="install">
          <p>
            Needs Node and an{' '}
            <Link href="/get-key" className="rm-link">
              API key
            </Link>
            .
          </p>
        </SectionHead>
        <div className="mt-8 max-w-2xl">
          <CodeExhibit tabs={[{ id: 'install', label: 'Install', code: CLI_INSTALL }]} />
        </div>
      </section>

      <section className="rm-section" aria-labelledby="commands">
        <SectionHead n="02" label="Commands" title="Commands" id="commands">
          <p>
            Each command below was run against production on {EXECUTED_ON}.{' '}
            <code className="rm-mono">riskmodels --help</code> lists the rest.
          </p>
        </SectionHead>
        <div className="rm-scroll-x mt-8">
          <table className="rm-table min-w-[44rem]">
            <thead>
              <tr>
                <th scope="col">Command</th>
                <th scope="col">Returns</th>
              </tr>
            </thead>
            <tbody>
              {COMMANDS.map((c) => (
                <tr key={c.command}>
                  <td className="rm-mono align-top text-[0.8125rem]">{c.command}</td>
                  <td className="align-top">{c.returns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
