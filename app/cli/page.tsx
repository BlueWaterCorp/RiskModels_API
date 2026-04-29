import type { Metadata } from 'next';
import TerminalShowcase from '@/components/TerminalShowcase';

export const metadata: Metadata = {
  title: 'CLI — RiskModels',
  description: 'Run decompose, portfolio snapshots, and queries from your terminal.',
};

const SCENARIO_IDS = ['decompose', 'estimate', 'riskmodels-cli'];

export default function CliPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden bg-zinc-950">
      <section className="border-b border-zinc-800 px-4 pb-12 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            CLI
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Three commands cover 90%
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-400 sm:text-lg">
            Decompose a ticker. Snapshot a portfolio. Query for the metric you need.
          </p>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <TerminalShowcase scenarioIds={SCENARIO_IDS} />
        </div>
      </section>
    </div>
  );
}
