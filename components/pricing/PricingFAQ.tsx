export type PricingFaqItem = { q: string; a: string };

/** Ruled question list. Native disclosure, so answers are reachable without script. */
export default function PricingFAQ({ items }: { items: PricingFaqItem[] }) {
  return (
    <div className="max-w-3xl border-t border-rule">
      {items.map((item) => (
        <details key={item.q} className="group border-b border-rule">
          <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-3 text-[1.0625rem] text-ink [&::-webkit-details-marker]:hidden">
            <span className="font-serif">{item.q}</span>
            <span aria-hidden className="rm-mono text-ink-muted group-open:hidden">+</span>
            <span aria-hidden className="rm-mono hidden text-ink-muted group-open:inline">−</span>
          </summary>
          <p className="rm-body pb-5 pr-8">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
