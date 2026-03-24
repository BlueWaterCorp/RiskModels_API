import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import {
  QUICKSTART_LANDING_CARDS,
  quickstartExampleHref,
} from '@/lib/quickstart-examples';

export function WhatYouCanDo() {
  return (
    <section
      id="what-you-can-do"
      className="relative scroll-mt-20 bg-zinc-950 py-24 lg:py-32"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/30 to-transparent"
        aria-hidden
      />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <h2 className="mb-10 text-center text-2xl font-bold text-white tracking-tighter md:text-3xl">
          What You Can Do
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          {QUICKSTART_LANDING_CARDS.map((card) => (
            <Link
              key={card.id}
              href={quickstartExampleHref(card.id)}
              className="group flex gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-primary/40 hover:bg-zinc-900/60"
            >
              <CheckCircle2
                className="mt-0.5 h-6 w-6 shrink-0 text-primary"
                aria-hidden
              />
              <div>
                <h3 className="font-semibold text-white group-hover:text-primary">
                  {card.title}
                </h3>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{card.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
