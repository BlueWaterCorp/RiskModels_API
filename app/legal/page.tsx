import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Legal / Disclosures',
  description:
    'Legal disclosures for RiskModels API, including no-investment-advice and no-warranty statements.',
};

const sections = [
  {
    title: 'No Investment Advice',
    summary: 'Nothing on RiskModels should be treated as a recommendation to trade.',
    body:
      'RiskModels API and all related content are provided for informational and analytical purposes only. Nothing on this site, in the API, or in related documentation constitutes investment, legal, tax, accounting, or other professional advice, or a recommendation to buy, sell, or hold any security.',
  },
  {
    title: 'Data and Model Limitations',
    summary: 'Model outputs are helpful analytics, not guaranteed facts or forecasts.',
    body:
      'Risk estimates, decompositions, hedge ratios, and other analytics are model-driven outputs based on historical and third-party data. These outputs may be incomplete, delayed, inaccurate, or unsuitable for a particular use case. Past performance and historical relationships do not guarantee future results.',
  },
  {
    title: 'No Warranty; Use at Your Own Risk',
    summary: 'We do not promise the API or its outputs are error-free or fit for your purpose.',
    body:
      'Blue Water Macro Corp. makes no representations or warranties, express or implied, regarding the accuracy, completeness, reliability, availability, or fitness for a particular purpose of the site, API, documentation, or any associated outputs. You are solely responsible for independently reviewing and validating any information before relying on it.',
  },
  {
    title: 'Limitation of Responsibility',
    summary: 'You are responsible for your use of the API and any decisions based on it.',
    body:
      'Blue Water Macro Corp. is not responsible for errors, omissions, interruptions, stale data, modeling limitations, or any losses or damages arising from the use of or reliance on RiskModels API or related materials, to the maximum extent permitted by law.',
  },
];

export default function LegalPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="relative overflow-hidden border-b border-zinc-800/80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_38%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.12),transparent_30%)]" />
        <div className="relative mx-auto max-w-5xl px-6 pt-24 pb-14">
          <div className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
            Legal
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Legal / Disclosures
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-zinc-300">
            Important terms for using RiskModels API, its documentation, and any
            related analytics. The short version: this is an analytical product,
            not investment advice, and you should independently validate anything
            you rely on.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-sm font-semibold text-zinc-100">
                Informational use only
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Outputs are for research, analytics, and workflow support.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-sm font-semibold text-zinc-100">
                Validate before acting
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Review assumptions, inputs, and results before using them in production or trading.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-sm font-semibold text-zinc-100">
                No warranty
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Availability, completeness, and fitness for a particular use are not guaranteed.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="mb-8 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
          <p className="text-sm font-semibold text-amber-200">Plain-English summary</p>
          <p className="mt-2 text-sm leading-7 text-zinc-300">
            RiskModels can help analyze equity risk and hedging decisions, but it
            does not replace professional judgment. If you use the API in any
            investment or operational workflow, you remain responsible for the
            decisions you make and for verifying the data and outputs.
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((section, index) => (
            <section
              key={section.title}
              className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-sm font-semibold text-blue-300">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    {section.title}
                  </h2>
                  <p className="mt-2 text-base font-medium text-zinc-200">
                    {section.summary}
                  </p>
                  <p className="mt-4 leading-7 text-zinc-400">{section.body}</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Questions about these disclosures?
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Contact us if you need clarification on permitted use, production
              deployment, or data handling expectations.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="mailto:service@riskmodels.app"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              Contact
            </a>
            <Link
              href="/docs/api"
              className="inline-flex items-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-600 hover:text-white"
            >
              API Docs
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
