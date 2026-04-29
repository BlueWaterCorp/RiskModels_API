const POINTS = [
  'Labels ≠ exposures.',
  "Risk systems don't return trades.",
  'Agents need structured risk context.',
];

export default function WhyThisMatters() {
  return (
    <section className="border-b border-zinc-800/80 bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Why this matters
          </p>
        </div>
        <ul className="space-y-4">
          {POINTS.map((p) => (
            <li
              key={p}
              className="text-xl font-medium leading-snug text-zinc-200 sm:text-2xl"
            >
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
