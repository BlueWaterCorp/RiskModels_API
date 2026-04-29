/**
 * Agent loop — text in, structured risk out, text answer.
 */
export default function AgentLoopSection() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Agent loop
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-zinc-400">
          Natural language on top of the same JSON your code already trusts.
        </p>

        <div className="mt-10 space-y-0 rounded-xl border border-zinc-800 bg-black/40">
          <div className="border-b border-zinc-800 px-4 py-4 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">User</p>
            <p className="mt-2 text-sm text-zinc-100 sm:text-base">
              Why did my portfolio lose money?
            </p>
          </div>
          <div className="flex items-center justify-center border-b border-zinc-800 bg-zinc-900/50 py-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              RiskModels API
            </span>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Agent response
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200 sm:text-base">
              Loss was driven primarily by semiconductor subsector exposure (SMH leg). Market and
              sector hedges would have muted most of the drawdown; residual risk was secondary.
              Hedge notionals are in the JSON if you want to rebalance without unwinding names.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
