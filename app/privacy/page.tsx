import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Blue Water Macro Corp (RiskModels) collects, uses, shares, and protects your data.',
};

// Same policy text as riskmodels.net/privacy (Risk_Models riskmodels_net/src/app/privacy),
// served on .app so connector and plugin directory listings point at this domain.
// Change the wording in both places together.

type Item = { label: string; text: string };

const sections: { title: string; intro: string; items: Item[] }[] = [
  {
    title: '1. Data Collection & Sources',
    intro:
      'We collect information to provide specialized risk audits and portfolio insurance prescriptions.',
    items: [
      {
        label: 'Directly from You',
        text: 'Contact details (name, email) provided during account registration.',
      },
      {
        label: 'Via Plaid API',
        text: 'With your explicit consent, we retrieve read-only data including investment holdings, quantities, cost basis, and transaction history. We never see or store your bank login credentials.',
      },
      {
        label: 'Technical Data',
        text: 'IP address, device type, and browser settings collected automatically to ensure secure access and prevent fraud.',
      },
    ],
  },
  {
    title: '2. How We Use Your Data',
    intro: 'Your data is used strictly for the following purposes:',
    items: [
      {
        label: 'Risk Analysis',
        text: 'Calculating factor-based beta sensitivity and identifying portfolio hedging opportunities.',
      },
      {
        label: 'Service Delivery',
        text: 'Authenticating your account and maintaining your customized dashboard.',
      },
      {
        label: 'Compliance',
        text: 'Meeting our regulatory recordkeeping obligations as an investment advisor.',
      },
      {
        label: 'Security',
        text: 'Monitoring for unauthorized access and ensuring infrastructure integrity.',
      },
      {
        label: 'Email Communications with Holdings Data',
        text: 'With your explicit consent, we may include your portfolio holdings data (ticker symbols, positions, values) in personalized email reports. This data is used solely to provide you with risk analysis and hedge recommendations. You can opt out of holdings data in emails at any time in your account settings.',
      },
    ],
  },
  {
    title: '3. Data Sharing & Third Parties',
    intro:
      'We do not sell your personal or financial data to third parties. Sharing is limited to:',
    items: [
      {
        label: 'Service Providers',
        text: 'Secured partners like Plaid (data aggregation) and Supabase (cloud storage) that are essential to our service functionality.',
      },
      {
        label: 'Legal Requirements',
        text: 'When required by law to respond to valid legal processes or regulatory inquiries (e.g., SEC audits).',
      },
    ],
  },
  {
    title: '4. Your Privacy Rights',
    intro: 'You maintain control over your information at all times:',
    items: [
      {
        label: 'Revocation of Consent',
        text: 'You can disconnect your financial accounts at any time through the RiskModels dashboard or the Plaid Portal.',
      },
      {
        label: 'Data Deletion',
        text: 'You may request the deletion of your account and associated personal data, which we will process within 30 days, subject to regulatory retention requirements.',
      },
      {
        label: 'Access & Portability',
        text: 'You have the right to request a copy of the personal information we hold about you.',
      },
    ],
  },
  {
    title: '5. Data Security',
    intro: 'We utilize institutional-grade safeguards to protect your data:',
    items: [
      {
        label: 'Encryption',
        text: 'All data is encrypted at rest (AES-256) and in transit (TLS 1.2+).',
      },
      {
        label: 'Phishing-Resistant MFA',
        text: 'Mandatory hardware-based multi-factor authentication for all production systems.',
      },
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="border-b border-zinc-800/80">
        <div className="mx-auto max-w-4xl px-6 pt-24 pb-12">
          <div className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
            Privacy
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-lg text-zinc-300">Blue Water Macro Corp (RiskModels)</p>
          <p className="mt-1 text-sm text-zinc-500">Last Updated: February 2025</p>
          <p className="mt-6 max-w-3xl leading-7 text-zinc-300">
            At RiskModels, we are committed to protecting your privacy and ensuring the
            security of your personal and financial information. This Privacy Policy
            explains how we collect, use, share, and protect your data when you use our
            risk analysis and portfolio insurance services.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl space-y-6 px-6 py-12">
        {sections.map((s) => (
          <section
            key={s.title}
            className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8"
          >
            <h2 className="text-2xl font-semibold tracking-tight text-white">{s.title}</h2>
            <p className="mt-2 text-sm text-zinc-400">{s.intro}</p>
            <ul className="mt-5 space-y-4">
              {s.items.map((it) => (
                <li key={it.label} className="leading-7">
                  <span className="font-medium text-zinc-100">{it.label}: </span>
                  <span className="text-zinc-400">{it.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h2 className="text-lg font-semibold text-white">Questions About Your Privacy?</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            If you have any questions or concerns about this Privacy Policy or our data
            practices, please contact us at{' '}
            <a href="mailto:service@riskmodels.app" className="text-blue-300 hover:text-blue-200">
              service@riskmodels.app
            </a>
            .
          </p>
          <p className="mt-2 text-sm text-zinc-500">Blue Water Macro Corp · RiskModels Platform</p>
        </div>
      </section>
    </main>
  );
}
