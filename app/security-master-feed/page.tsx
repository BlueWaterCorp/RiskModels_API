// app/security-master-feed/page.tsx
// Landing page + early-access signup for the security master change feed.
// A printed flyer links to /security-master-feed: keep this path stable.
//
// The feed is not live. Copy must not claim delivery, coverage counts or
// latency that have not been measured. The sample event below is labelled
// as an illustrative format and uses placeholder values only.

import type { Metadata } from "next";
import Link from "next/link";
import FeedWaitlistForm from "@/components/feed/FeedWaitlistForm";

const TITLE = "Security Master Change Feed — Early Access";
const DESCRIPTION =
  "A daily, SEC-filing-cited feed of US equity identity and status events: ticker and name changes, listing status, mergers and reorganisations, and splits, with corrections and point-in-time known-as-of dates. Early access; free to early clients for about a year.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/security-master-feed" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://riskmodels.app/security-master-feed",
  },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-1.5">
      {children}
    </p>
  );
}

function SectionDivider() {
  return (
    <div className="max-w-4xl mx-auto px-6">
      <hr className="border-zinc-800/80" />
    </div>
  );
}

function Check() {
  return (
    <svg className="w-3.5 h-3.5 text-blue-400 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const EDITION_CONTENTS = [
  {
    h: "Identity and status events",
    p: "Ticker and name changes, listing status (Form 25 and 8-K Item 3.01), mergers and reorganisations, and splits.",
  },
  {
    h: "A filing behind every event",
    p: "Each event carries its effective date and a citation to the SEC filing that supports it.",
  },
  {
    h: "Corrections in the open",
    p: "Each edition lists changes to facts published in earlier editions: the old value, the new value, the edition it first appeared in, and the reason.",
  },
  {
    h: "Point-in-time known-as-of dates",
    p: "Every fact carries the edition date on which it became known, so you can reconstruct what was known on any past day.",
  },
  {
    h: "Open keys",
    p: "FIGI, SEC CIK, the RiskModels security id, and ticker. No identifiers from licensed data feeds.",
  },
] as const;

const OUT_OF_SCOPE = [
  "Dividends, tender offers and holder elections",
  "Price and model-value corrections (these go in the full RiskModels release notes)",
  "Non-US listings",
] as const;

const EARLY_ACCESS = [
  "Free to early clients for about the first year",
  "The spec and an illustrative sample before the first edition",
  "A say in the delivery format: email digest, API, or webhook",
] as const;

// Placeholder values only — not a real security or filing.
const ILLUSTRATIVE_EDITION = `{
  "edition": "YYYY-MM-DD",
  "events": [
    {
      "event_type": "ticker_change",
      "effective_date": "YYYY-MM-DD",
      "known_as_of": "YYYY-MM-DD",
      "keys": {
        "figi": "BBG000000000",
        "cik": "0000000000",
        "riskmodels_id": "BW-EXAMPLE",
        "ticker": "NEWT"
      },
      "old_value": "OLDT",
      "new_value": "NEWT",
      "filing": {
        "form": "8-K",
        "accession": "0000000000-00-000000",
        "filed": "YYYY-MM-DD"
      }
    }
  ],
  "corrections": [
    {
      "field": "name",
      "keys": { "riskmodels_id": "BW-EXAMPLE" },
      "old_value": "Example Holdings Inc",
      "new_value": "Example Holdings Corp",
      "first_published_in": "YYYY-MM-DD",
      "reason": "filing_reread"
    }
  ]
}`;

export default function SecurityMasterFeedPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-12 pb-8 text-center">
        <SectionLabel>Security master change feed · Early access</SectionLabel>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
          A daily, filing-cited record of US equity identity changes
        </h1>
        <p className="text-base text-zinc-300 max-w-2xl mx-auto mb-4 leading-relaxed">
          Ticker and name changes, listing status, mergers and reorganisations, and splits, each
          tied to the SEC filing that supports it, with corrections to earlier editions published in
          the open.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center mb-4">
          <a
            href="#join"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 transition-colors text-sm"
          >
            Join the early-access list
          </a>
          <a
            href="#format"
            className="inline-flex items-center justify-center rounded-md border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-5 py-2.5 transition-colors text-sm"
          >
            See the format
          </a>
        </div>
        <p className="text-sm text-zinc-500 max-w-2xl mx-auto leading-snug">
          The feed is in development and not yet delivered. Join the list to hear first, and to get
          it free for about a year as an early client.
        </p>
      </section>

      <SectionDivider />

      {/* ── What each edition contains ── */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <SectionLabel>What each edition contains</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-5">One edition with each daily data release</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {EDITION_CONTENTS.map((item) => (
            <div
              key={item.h}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md p-5"
            >
              <p className="text-base font-bold text-white mb-1.5">{item.h}</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{item.p}</p>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">
            Not in scope
          </p>
          <ul className="space-y-1.5">
            {OUT_OF_SCOPE.map((item) => (
              <li key={item} className="text-sm text-zinc-400 leading-snug">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-zinc-500 leading-snug">
            Event types are limited to what SEC filings support. The feed is the identity part of
            each RiskModels data release, the same record the{" "}
            <Link href="/docs/api" className="text-blue-400 hover:text-blue-300">
              RiskModels API
            </Link>{" "}
            uses to resolve historical tickers.
          </p>
        </div>
      </section>

      <SectionDivider />

      {/* ── Illustrative format ── */}
      <section id="format" className="mx-auto max-w-4xl px-4 sm:px-6 py-10 scroll-mt-20">
        <SectionLabel>Illustrative format</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">What an edition looks like</h2>
        <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
          Placeholder values, not a real security or filing. Field names may change before the first
          edition; early-access members see the spec first.
        </p>
        <div className="relative rounded-lg border border-zinc-800/80 bg-zinc-900/60">
          <span className="absolute top-2 right-2 rounded-md border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-300">
            Illustrative format
          </span>
          <pre className="overflow-x-auto p-4 pt-9 text-xs leading-relaxed text-zinc-300">
            <code>{ILLUSTRATIVE_EDITION}</code>
          </pre>
        </div>
      </section>

      <SectionDivider />

      {/* ── Signup ── */}
      <section id="join" className="mx-auto max-w-4xl px-4 sm:px-6 py-10 scroll-mt-20">
        <div className="grid gap-6 md:grid-cols-5">
          <div className="md:col-span-2">
            <SectionLabel>Early access</SectionLabel>
            <h2 className="text-xl font-bold text-white mb-3">Join the list</h2>
            <ul className="space-y-2">
              {EARLY_ACCESS.map((item) => (
                <li key={item} className="flex items-start gap-1.5 text-sm text-zinc-300 leading-snug">
                  <Check />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-zinc-500 leading-snug">
              Questions:{" "}
              <a href="mailto:service@riskmodels.app" className="text-blue-400 hover:text-blue-300">
                service@riskmodels.app
              </a>
            </p>
          </div>
          <div className="md:col-span-3 rounded-xl border border-blue-500/30 bg-zinc-900/40 backdrop-blur-md p-5 shadow-[0_0_60px_-20px_rgba(59,130,246,0.25)]">
            <FeedWaitlistForm />
          </div>
        </div>
      </section>
    </main>
  );
}
