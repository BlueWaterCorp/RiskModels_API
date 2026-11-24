// app/security-master-feed/page.tsx
// Landing page + early-access signup for the security master change feed.
// A printed flyer links to /security-master-feed: keep this path stable.
//
// Early access. The feed is free, for approved investment, research, risk and
// data professionals: the form is a request, reviewed by a person. Copy must not
// claim coverage counts or latency that have not been measured. The rows and
// the record shown are the public sample served by ./latest.json, read at
// render; when it cannot be read the page says so.

import type { Metadata } from "next";
import Link from "next/link";
import FeedWaitlistForm from "@/components/feed/FeedWaitlistForm";
import { FeedTable } from "@/components/site/FeedTable";
import { SectionHead } from "@/components/site/SectionHead";
import { getFeedSample } from "@/lib/site/live";

export const revalidate = 300;

const TITLE = "Security Master Change Feed — Early Access";
const DESCRIPTION =
  "A daily, SEC-filing-cited feed of US equity identity and status events: ticker and name changes, listing status, mergers and reorganisations, and splits, with corrections and point-in-time known-as-of dates. Early access; free for approved investment, research, risk and data professionals.";

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
  "For investment, research, risk and data professionals; a person reviews each request",
  "Approved subscribers get email editions and a private RSS address",
  "A say in the delivery format: email digest, API, or webhook",
] as const;


export default async function SecurityMasterFeedPage() {
  const feed = await getFeedSample();
  const first = feed?.events[0];
  return (
    <div className="rm-page pb-24">
      <header className="pb-14 pt-12 sm:pt-16">
        <p className="rm-label">Security master change feed · Early access</p>
        <h1 className="rm-h1 mt-4 max-w-4xl">A daily, filing-cited record of US equity identity changes</h1>
        <p className="rm-lede mt-6 max-w-2xl">
          Ticker and name changes, listing status, mergers and reorganisations, and splits, each tied to the
          SEC filing that supports it. Corrections to earlier editions are published in the open.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#join" className="rm-btn">
            Request free access
          </a>
          <a href="#format" className="rm-btn-ghost">
            See a record
          </a>
        </div>
        <p className="rm-small mt-4 max-w-2xl">
          Free for verified investment, research, risk and data professionals. Approved subscribers read
          current events by email and{" "}
          <Link href="/security-master-feed/access" className="rm-link">
            private RSS
          </Link>
          . All data is end-of-day and historical.
        </p>
      </header>

      <section className="rm-section" aria-labelledby="sample">
        <SectionHead n="01" label="Public sample" title="The current public sample" id="sample">
          <p>
            {feed?.sample_note ??
              "The public sample holds a small number of recent events; approved subscribers receive current events."}
          </p>
        </SectionHead>
        <div className="mt-8">
          {feed ? (
            <>
              <FeedTable events={feed.events} />
              <p className="rm-small mt-4">
                Read from{" "}
                <Link href="/security-master-feed/latest.json" prefetch={false} className="rm-link rm-mono">
                  /security-master-feed/latest.json
                </Link>
                , generated {feed.generated_at.slice(0, 10)}. A longer dated sample is at{" "}
                <a href="https://www.riskmodels.org/events" className="rm-link">
                  riskmodels.org/events
                </a>
                .
              </p>
            </>
          ) : (
            <p className="rm-small border-y border-rule py-4">
              Data unavailable. The read of the feed sample failed; it is served at{" "}
              <Link href="/security-master-feed/latest.json" prefetch={false} className="rm-link rm-mono">
                /security-master-feed/latest.json
              </Link>
              .
            </p>
          )}
        </div>
      </section>

      <section className="rm-section" aria-labelledby="contents">
        <SectionHead n="02" label="Contents" title="One edition with each daily data release" id="contents" />
        <dl className="mt-8 divide-y divide-[var(--rm-rule)] border-y border-rule">
          {EDITION_CONTENTS.map((item) => (
            <div key={item.h} className="grid gap-x-8 gap-y-1 py-4 lg:grid-cols-12">
              <dt className="rm-h3 lg:col-span-4">{item.h}</dt>
              <dd className="rm-body lg:col-span-8">{item.p}</dd>
            </div>
          ))}
          <div className="grid gap-x-8 gap-y-1 py-4 lg:grid-cols-12">
            <dt className="rm-h3 lg:col-span-4">Outside scope</dt>
            <dd className="rm-body lg:col-span-8">{OUT_OF_SCOPE.join("; ")}.</dd>
          </div>
        </dl>
        <p className="rm-small mt-4 max-w-3xl">
          Event types are limited to what SEC filings support. The feed is the identity part of each RiskModels
          data release, the same record the{" "}
          <Link href="/docs/api" className="rm-link">
            RiskModels API
          </Link>{" "}
          uses to resolve historical tickers.
        </p>
      </section>

      <section className="rm-section" aria-labelledby="format">
        <SectionHead n="03" label="Format" title="One record, as served" id="format">
          <p>
            The first event of the public sample, printed as the file returns it. Field names may change
            during early access; subscribers are told first.
          </p>
        </SectionHead>
        <div className="mt-8">
          {first ? (
            <figure className="rm-plate min-w-0">
              <figcaption className="rm-label border-b border-rule px-3 py-2 sm:px-4">
                latest.json · events[0] · generated {feed.generated_at.slice(0, 10)}
              </figcaption>
              <pre className="rm-code px-3 py-3 sm:px-4">
                <code>{JSON.stringify(first, null, 2)}</code>
              </pre>
            </figure>
          ) : (
            <p className="rm-small border-y border-rule py-4">Data unavailable. No record could be read.</p>
          )}
        </div>
      </section>

      <section className="rm-section" aria-labelledby="join">
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
          <div>
            <p className="rm-label">04 · Early access</p>
            <h2 id="join" className="rm-h2 mt-3">
              Request access
            </h2>
            <ul className="mt-6 divide-y divide-[var(--rm-rule)] border-y border-rule">
              {EARLY_ACCESS.map((item) => (
                <li key={item} className="py-3 text-[0.9375rem] text-ink">
                  {item}
                </li>
              ))}
            </ul>
            <p className="rm-body mt-6">
              You confirm your email, then we review the request and email you the decision. Work and academic
              addresses with a complete profile are ordinarily approved. Personal addresses are reviewed by
              hand; a firm website or LinkedIn profile helps.
            </p>
            <p className="rm-small mt-4">
              Already approved?{" "}
              <Link href="/security-master-feed/access" className="rm-link">
                Create your private RSS address
              </Link>
              . Questions:{" "}
              <a href="mailto:service@riskmodels.app" className="rm-link">
                service@riskmodels.app
              </a>
            </p>
          </div>
          <div className="min-w-0">
            <FeedWaitlistForm />
          </div>
        </div>
      </section>
    </div>
  );
}
