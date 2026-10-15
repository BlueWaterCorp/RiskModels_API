import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What data RiskModels (Blue Water Macro Corp.) collects through riskmodels.app, the API and the MCP connector, and how it is used, shared, kept and protected.',
};

// Policy for riskmodels.app: website, REST API, MCP connector and SDK.
// riskmodels.net keeps its own policy (Risk_Models riskmodels_net/src/app/privacy).
// Every statement here should match what the code does; check the code before
// changing a sentence, and update "Last updated".

const LAST_UPDATED = 'October 15, 2026';

type Item = { label: string; text: string };
type Section = { title: string; intro?: string; items?: Item[]; paragraphs?: string[] };

const sections: Section[] = [
  {
    title: '1. Information we collect',
    items: [
      {
        label: 'Account',
        text: 'Your email address, and your name if you sign in with Google or GitHub. You can also sign in with an email link or a password we issue to you.',
      },
      {
        label: 'API keys and connector sign-ins',
        text: 'When you create an API key or connect RiskModels to an AI client such as Claude, ChatGPT, Gemini or Cursor, we store the key or token only in hashed form, with a short prefix, its name, scopes and when it was last used. For connector sign-ins we also store the client name and registration details the client sends.',
      },
      {
        label: 'Usage records',
        text: 'For each billed API or connector call we record your account, the endpoint, the cost, the time, the response status and speed, the request URL, your IP address and user agent, and the tickers named in the request (up to 50), with any dates and item counts. We do not record position weights, share counts or dollar values.',
      },
      {
        label: 'Portfolios you submit',
        text: 'Holdings you send to the portfolio, hedge and decomposition endpoints are used to compute the response and are not stored in our database. Some responses are cached for up to 24 hours so repeated requests return the same result. Exposure-history files are kept in private storage, reachable only through a link that expires after one hour, and deleted daily.',
      },
      {
        label: 'Saved portfolios and brokerage connections',
        text: 'Portfolios you save in your account are stored encrypted. If you link a brokerage account through Plaid, we store an encrypted Plaid access token and fetch holdings when you ask for them; we do not store the holdings or your brokerage login.',
      },
      {
        label: 'Payments',
        text: 'Card payments are handled by Stripe. We keep the Stripe customer and payment method references, top-up amounts and your credit balance history. We never receive or store card numbers.',
      },
      {
        label: 'Email',
        text: 'We send service emails (welcome, key issued or expiring, receipts, low balance, usage reports, digests). We log each email sent and whether it was opened or a link was clicked.',
      },
      {
        label: 'Feedback',
        text: 'If you send feedback through the site or API, we store your comment with your IP address and user agent.',
      },
      {
        label: 'Website analytics and advertising',
        text: 'Our website uses PostHog, Google Analytics, Google Tag Manager and Google Ads, which set cookies and record pages viewed and clicks. When you sign up, the Google Ads tag may send your email address, hashed by the tag, to Google to measure ad conversions. If you arrive from an ad or campaign link, we keep the click and campaign identifiers in your browser and store them with your account at sign-up.',
      },
      {
        label: 'Chat assistant',
        text: 'Messages you send to the RiskModels chat assistant, and the data its tools return, are sent to an AI model provider (Anthropic or Moonshot AI) to generate the reply.',
      },
    ],
  },
  {
    title: '2. How we use it',
    items: [
      { label: 'Provide the service', text: 'Authenticate you, run your requests and return results.' },
      { label: 'Billing', text: 'Charge each call against your credit balance and keep receipts.' },
      {
        label: 'Security and reliability',
        text: 'Rate-limit requests, detect abuse and diagnose errors.',
      },
      { label: 'Support and service emails', text: 'Answer your questions and tell you about your account.' },
      {
        label: 'Improve the product',
        text: 'Understand which endpoints and tickers are used, mostly in aggregate.',
      },
      { label: 'Marketing measurement', text: 'Measure which campaigns bring sign-ups.' },
    ],
    paragraphs: [
      'We do not sell your personal data, and we do not use your portfolios or requests to train AI models.',
    ],
  },
  {
    title: '3. Who we share it with',
    intro: 'Service providers that process data for us:',
    items: [
      { label: 'Vercel', text: 'website and API hosting.' },
      { label: 'Supabase', text: 'sign-in, database and private file storage.' },
      { label: 'Upstash', text: 'rate limiting and short-lived caches.' },
      { label: 'Stripe', text: 'payments.' },
      { label: 'Resend', text: 'email delivery.' },
      { label: 'Plaid', text: 'brokerage connections, only if you link an account.' },
      { label: 'PostHog and Google', text: 'website analytics and ad measurement; Google and GitHub also for sign-in if you choose them.' },
      { label: 'Anthropic and Moonshot AI', text: 'the chat assistant only.' },
    ],
    paragraphs: [
      'When you use RiskModels through an AI client (Claude, ChatGPT, Gemini, Cursor or another), the results we return go to that client and are handled under its provider’s privacy policy.',
      'We may also disclose information when required by law or to protect our rights and users.',
    ],
  },
  {
    title: '4. How long we keep it',
    items: [
      { label: 'Account data', text: 'while your account is open.' },
      { label: 'Usage and billing records', text: 'as long as needed for billing, accounting and tax records.' },
      { label: 'Cached responses', text: 'up to 24 hours.' },
      { label: 'Exposure-history files', text: 'deleted daily.' },
      {
        label: 'Connector sign-ins',
        text: 'authorization codes expire after 5 minutes, access tokens after 1 hour, refresh tokens after 30 days or when you revoke them.',
      },
    ],
  },
  {
    title: '5. Your choices and rights',
    items: [
      {
        label: 'Access, correction and deletion',
        text: 'Email service@riskmodels.app to get a copy of your data, correct it, or delete your account. We complete deletion within 30 days, except records we must keep for billing, tax or legal reasons.',
      },
      {
        label: 'Keys and connectors',
        text: 'Revoke API keys in your account at any time. Removing RiskModels from an AI client stops its access; ask us if you also want its sign-in revoked on our side.',
      },
      { label: 'Brokerage connections', text: 'Disconnect through your account or the Plaid Portal.' },
      { label: 'Cookies', text: 'Visitors in the EEA, UK and Switzerland choose whether to allow analytics and advertising cookies in a banner; until they accept, those tags run without cookies. Anyone can block or delete cookies in their browser settings; the API and connector do not need them.' },
    ],
  },
  {
    title: '6. Security',
    paragraphs: [
      'Data travels over TLS and is encrypted at rest by our hosting providers. API keys and connector tokens are stored only as hashes. Plaid access tokens are encrypted with AES-256-GCM. Access to production systems is limited to the people who run the service.',
    ],
  },
  {
    title: '7. Other',
    paragraphs: [
      'RiskModels is a professional analytics service and is not directed to children under 18.',
      'If we change this policy we will update the date at the top, and we will email account holders about material changes.',
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
          <p className="mt-3 text-lg text-zinc-300">Blue Water Macro Corp. (RiskModels)</p>
          <p className="mt-1 text-sm text-zinc-500">Last updated: {LAST_UPDATED}</p>
          <p className="mt-6 max-w-3xl leading-7 text-zinc-300">
            This policy covers riskmodels.app, the RiskModels API, the RiskModels MCP
            connector used from AI clients, and the RiskModels SDKs. It explains what we
            collect, why, who we share it with, how long we keep it, and the choices you
            have.
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
            {s.intro && <p className="mt-2 text-sm text-zinc-400">{s.intro}</p>}
            {s.items && (
              <ul className="mt-5 space-y-4">
                {s.items.map((it) => (
                  <li key={it.label} className="leading-7">
                    <span className="font-medium text-zinc-100">{it.label}: </span>
                    <span className="text-zinc-400">{it.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.paragraphs?.map((p) => (
              <p key={p} className="mt-4 leading-7 text-zinc-400">
                {p}
              </p>
            ))}
          </section>
        ))}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h2 className="text-lg font-semibold text-white">Contact</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Questions about this policy or your data:{' '}
            <a href="mailto:service@riskmodels.app" className="text-blue-300 hover:text-blue-200">
              service@riskmodels.app
            </a>
            .
          </p>
          <p className="mt-2 text-sm text-zinc-500">Blue Water Macro Corp. · RiskModels</p>
        </div>
      </section>
    </main>
  );
}
