import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'RiskModels in ChatGPT — Demo',
  description:
    'Screen recording of the RiskModels ChatGPT app reading a sample long/short brokerage book and decomposing its risk.',
};

const VIDEO_SRC =
  'https://storage.googleapis.com/rm_api_public/demo/riskmodels-chatgpt-demo.mp4';
const SHARE_URL = 'https://chatgpt.com/share/6acd4f36-303c-83e8-b177-71c94b0b51ba';

const PROMPTS = [
  'Show my linked sample brokerage positions, including longs and shorts.',
  'Summarize the total long exposure, short exposure, net exposure, and gross exposure.',
  'Which positions are the largest by absolute market value?',
  "Use RiskModels to break down the portfolio's exposure by sector.",
  'Identify the positions contributing the most systematic and residual risk.',
  'What ETF trades would neutralize the portfolio at the recommended hedge level?',
  'Explain the results in plain English for an investor.',
];

export default function ChatGptDemoPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden bg-zinc-950">
      <section className="border-b border-zinc-800 px-4 pb-10 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            ChatGPT app demo
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            A long/short book, decomposed in ChatGPT
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-400 sm:text-lg">
            The RiskModels app reads a linked sample brokerage book of 8 longs and 6 shorts, then
            breaks its risk into market, sector, subsector and stock-specific parts and lists the
            ETF trades that would neutralize the modeled exposures.
          </p>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <video
            className="w-full rounded-lg border border-zinc-800"
            src={VIDEO_SRC}
            controls
            playsInline
            preload="metadata"
          />
          <p className="mt-3 text-sm text-zinc-500">
            Unedited screen recording (4 min 55 s). Sample portfolio data; no personal account
            information.{' '}
            <a href={SHARE_URL} className="text-zinc-300 underline hover:text-white">
              Read a shared ChatGPT conversation with the same prompts
            </a>
            .
          </p>

          <h2 className="mt-10 text-lg font-semibold text-white">Prompts in the recording</h2>
          <ol className="mt-3 list-decimal space-y-1 pl-6 text-sm text-zinc-400">
            {PROMPTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>

          <p className="mt-8 text-sm text-zinc-400">
            The integration is read-only. It reads positions and returns analytics; it does not
            place, modify or cancel orders.
          </p>
        </div>
      </section>
    </div>
  );
}
