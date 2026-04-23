import CodeBlock from '@/components/CodeBlock';

const AAPL_REQUEST = `{
  "ticker": "AAPL"
}`;

const AAPL_RESPONSE = `{
  "ticker": "AAPL",
  "exposure": {
    "market":    { "er": 0.51, "hr": 1.05, "hedge_etf": "SPY" },
    "sector":    { "er": 0.02, "hr": 0.08, "hedge_etf": "XLK" },
    "subsector": { "er": 0.00, "hr": 0.00, "hedge_etf": "XLK" },
    "residual":  { "er": 0.47, "hr": null, "hedge_etf": null }
  },
  "hedge": { "SPY": -1.05, "XLK": -0.08 }
}`;

export default function OneFunction() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl">
            Start with <span className="text-primary">one call.</span>
          </h2>
          <p className="mt-3 font-mono text-sm text-zinc-400 sm:text-base">
            POST <span className="text-primary">/decompose</span>
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Decouple any position into four tradable bets &mdash; one call returns
            ETF hedge ratios for each layer.
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Input
            </div>
            <CodeBlock code={AAPL_REQUEST} language="json" />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Output
            </div>
            <CodeBlock code={AAPL_RESPONSE} language="json" />
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-zinc-400 sm:text-base">
          AAPL behaves more like the market than a pure tech bet. If your
          thesis is &ldquo;tech exposure,&rdquo; this is the wrong instrument.
        </p>
      </div>
    </section>
  );
}
