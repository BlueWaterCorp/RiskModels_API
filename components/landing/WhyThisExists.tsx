export default function WhyThisExists() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl md:text-5xl">
          Most portfolios don&rsquo;t know{' '}
          <span className="text-primary">what they actually own.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
          Traditional tools aggregate first, then explain later. RiskModels
          works the other way.
        </p>

        <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-1">
          {[
            'Every position is split into 4 additive layers.',
            'Each layer maps to a tradable instrument.',
            'The output is directly actionable &mdash; no post-processing, no factor mystery.',
          ].map((line) => (
            <li
              key={line}
              className="rounded-lg border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200 sm:text-base"
              dangerouslySetInnerHTML={{ __html: line }}
            />
          ))}
        </ul>

        <p className="mx-auto mt-8 max-w-2xl text-sm font-semibold text-primary sm:text-base">
          Agents can reason about positions, not just portfolios.
        </p>
      </div>
    </section>
  );
}
