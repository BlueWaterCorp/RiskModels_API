import type { Metadata } from 'next';
import Link from 'next/link';
import { FEED_TERMS_VERSION } from '@/lib/feed-waitlist';
import { LEGAL_ENTITY, LEGAL_MAILING_ADDRESS } from '@/emails/constants';

// Terms of the free edition of the RiskModels Event Ledger (the daily email edition and its
// attached JSON Lines file). Signups record FEED_TERMS_VERSION; bump it in lib/feed-waitlist.ts
// with any material change here.

export const metadata: Metadata = {
  title: 'Event Ledger free edition terms',
  description:
    'Terms for the free edition of the RiskModels Event Ledger: internal use within your firm and quoting with attribution; no bulk redistribution, resale or competing feeds.',
  alternates: { canonical: '/legal/feed-terms' },
};

const sections: { title: string; body: string[] }[] = [
  {
    title: '1. What these terms cover',
    body: [
      `These terms apply to the free edition of the RiskModels Event Ledger: the daily email edition, its attached data file (events_YYYY-MM-DD.jsonl) and the latest-events list on riskmodels.org, together "the free edition". RiskModels is a registered DBA of ${LEGAL_ENTITY} ("we"). By joining the list you accept them. Paid licences and the RiskModels API are covered by their own terms.`,
    ],
  },
  {
    title: '2. What you may do',
    body: [
      'Use the free edition inside your firm: read it, share it with colleagues at your firm, load it into your firm’s internal systems, and check it against your own records.',
      'Quote individual events, or a small number of them, in research, reports, articles and messages, with attribution to "RiskModels Event Ledger" and, where practical, a link to riskmodels.app.',
      'Forward an edition to a colleague so they can see it and sign up for their own copy.',
    ],
  },
  {
    title: '3. What you may not do',
    body: [
      'Redistribute the free edition in bulk: no reposting or re-publishing whole editions or data files, no systematic forwarding outside your firm, and no feeding them into a service that others use.',
      'Resell it, sublicense it, or include it in a product or data service you offer to others.',
      'Use it to build, train or supplement a competing event, corporate-action or security master feed.',
      'Remove or change the attribution, the licence label of an event, or the notices in an edition.',
      'Redistribution, bulk or external use, or use in a product needs a paid licence. Write to service@riskmodels.app.',
    ],
  },
  {
    title: '4. What is in it, and what is not',
    body: [
      'Events come from public SEC filings (EDGAR) and from fields RiskModels derives from them and from its own records. Each line of the data file carries a license_label saying what it is.',
      'The free edition never contains exact market capitalisation values, or prices. Figures RiskModels computes from market data (for example size buckets, ranks, weights and risk metrics) are its own derived data and may appear. The free edition is not a source of prices or market data.',
      'Credit for third-party sources is shown where their terms ask for it.',
    ],
  },
  {
    title: '5. As is, no warranty',
    body: [
      'The free edition is provided as is and as available, without warranty of any kind, express or implied, including accuracy, completeness, timeliness, or fitness for a particular purpose. It may be late, incomplete or wrong. Check the cited filing before you rely on an event.',
      'To the maximum extent permitted by law, we are not liable for any loss arising from use of, or reliance on, the free edition.',
    ],
  },
  {
    title: '6. Corrections and withdrawals',
    body: [
      'We correct mistakes in the open. A correction is published as a new event that names the event it replaces, with the reason; a withdrawn event is flagged as withdrawn. Corrections and withdrawals are flagged in the edition in which they appear. Earlier editions are not edited after they are sent.',
    ],
  },
  {
    title: '7. Not investment advice',
    body: [
      'The free edition is general and impersonal information about public filings. It is not investment, legal, tax or accounting advice, and not a recommendation to buy, sell or hold any security. It is not tailored to anyone’s circumstances.',
    ],
  },
  {
    title: '8. Changes and ending',
    body: [
      'We may change these terms or stop the free edition at any time. A material change gets a new version date on this page. You can stop at any time with the unsubscribe link in any edition.',
    ],
  },
];

export default function FeedTermsPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto max-w-3xl px-4 sm:px-6 pt-20 pb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-2">Legal</p>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Event Ledger free edition terms</h1>
        <p className="mt-3 text-sm text-zinc-400">Version {FEED_TERMS_VERSION}</p>
        <p className="mt-5 text-base leading-7 text-zinc-300">
          The short version: use it inside your firm and quote it with attribution. Do not redistribute it in bulk,
          resell it, or build a competing feed from it; that needs a paid licence. It comes as is, corrections are
          flagged in the open, and it is not investment advice.
        </p>
      </section>
      <section className="mx-auto max-w-3xl px-4 sm:px-6 pb-16 space-y-8">
        {sections.map((s) => (
          <div key={s.title}>
            <h2 className="text-lg font-semibold text-white mb-2">{s.title}</h2>
            <div className="space-y-2">
              {s.body.map((p) => (
                <p key={p} className="text-sm leading-6 text-zinc-300">
                  {p}
                </p>
              ))}
            </div>
          </div>
        ))}
        <div className="border-t border-zinc-800 pt-6 text-sm text-zinc-400 space-y-2">
          <p>
            {LEGAL_ENTITY}, {LEGAL_MAILING_ADDRESS}. Questions or licensing:{' '}
            <a href="mailto:service@riskmodels.app" className="text-blue-400 hover:text-blue-300">
              service@riskmodels.app
            </a>
            .
          </p>
          <p>
            See also the{' '}
            <Link href="/legal" className="text-blue-400 hover:text-blue-300">
              legal disclosures
            </Link>{' '}
            and the{' '}
            <Link href="/privacy" className="text-blue-400 hover:text-blue-300">
              privacy policy
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
