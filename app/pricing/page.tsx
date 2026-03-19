// app/pricing/page.tsx
// Developer pricing page for riskmodels.app
// Mirrors the developer pricing from riskmodels.net/pricing?tab=developers

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing — RiskModels API",
  description:
    "Simple pay-as-you-go pricing for the RiskModels API. Start free with $20 in credits. No subscriptions, no seat fees — pay only for what you use.",
};

// ─── Data ────────────────────────────────────────────────────────────────────

const usageRows = [
  {
    action: "Risk decomposition (full)",
    tokens: "500",
    yield: "~2,000 per $20",
  },
  {
    action: "Ticker returns lookup",
    tokens: "250",
    yield: "~4,000 per $20",
  },
  {
    action: "Batch position analysis",
    tokens: "100 / position",
    yield: "~10,000 per $20",
  },
];

const rateLimitRows = [
  {
    tier: "Standard",
    limit: "30 req / min",
    best: "Research, development, most apps",
  },
  {
    tier: "Enterprise",
    limit: "100+ req / min",
    best: "High-frequency, production systems",
  },
];

const faqs = [
  {
    q: "Do my free credits expire?",
    a: "Your $20 in free credits never expire. However, your API key requires at least one call every 90 days to stay active. After 90 days of complete inactivity the key is automatically deactivated — not deleted — for security. You can reactivate instantly from your dashboard or by making any API call.",
  },
  {
    q: "What happens when I run out of credits?",
    a: "Without auto-refill enabled, API calls return 402 Payment Required and you manually top up from your developer dashboard. With auto-refill on, your card on file is charged for your chosen refill amount (e.g. $50 for 2.5M tokens) and requests continue without interruption. Auto-refill is optional and off by default.",
  },
  {
    q: "Can I set a monthly spend cap?",
    a: "Yes. Set a hard cap in your developer dashboard. Once hit, API calls are paused until the next billing cycle and you receive an email notification. You can raise the cap at any time. This prevents surprise bills from runaway scripts or unexpected traffic spikes.",
  },
  {
    q: "Is there a volume discount?",
    a: "For high-volume usage (10M+ tokens / month) we offer custom Enterprise pricing with dedicated rate limits (100+ req/min), committed-use discounts, priority support, SLA guarantees, and custom integration assistance. Contact us for a quote.",
  },
  {
    q: "Is my API data encrypted?",
    a: "Yes. API keys are SHA-256 hashed with timing-safe verification. Any sensitive user data you submit is encrypted per-portfolio with unique Data Encryption Keys (DEKs) wrapped by GCP KMS — the same zero-knowledge standard used across the RiskModels platform.",
  },
  {
    q: "Can I use both the API and a Pro investor subscription?",
    a: "Absolutely. Pro (investor dashboard) and Pay-as-You-Go (API access) are billed independently and can be used together or separately. They share the same underlying risk models and zero-knowledge encryption standards.",
  },
];

// ─── Components ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-3">
      {children}
    </p>
  );
}

function Divider() {
  return <hr className="border-zinc-800 my-16" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-6 pt-24 pb-12 text-center">
        <SectionLabel>Pricing</SectionLabel>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">
          Simple, pay-as-you-go
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
          No subscriptions. No seat fees. No surprise bills. Start free with{" "}
          <span className="text-white font-semibold">$20 in credits</span>{" "}
          — then pay{" "}
          <span className="text-white font-semibold">$20 per million tokens</span>.
        </p>
      </section>

      {/* ── Main pricing card ── */}
      <section className="mx-auto max-w-4xl px-6 pb-8">
        <div className="rounded-2xl border border-blue-500/30 bg-zinc-900 overflow-hidden">
          {/* Card header */}
          <div className="px-8 pt-8 pb-6 border-b border-zinc-800">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-400 mb-1">
                  Pay-as-You-Go
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-white">$20</span>
                  <span className="text-zinc-400 text-lg">/ 1M tokens</span>
                </div>
                <p className="text-sm text-zinc-500 mt-1">
                  = $0.000020 per token
                </p>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-3 py-1">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Free $20 to start — no card required
                </span>
                <p className="text-xs text-zinc-500">Credits never expire</p>
              </div>
            </div>
          </div>

          {/* Includes */}
          <div className="px-8 py-6 border-b border-zinc-800">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">
              Included with every account
            </p>
            <ul className="grid sm:grid-cols-2 gap-3">
              {[
                "Full access to all ~3,000 US equities",
                "41-factor ERM3 risk decompositions",
                "Hedge ratios at L1 / L2 / L3",
                "Historical data back to 2006",
                "REST API + CLI access",
                "TypeScript, Python, cURL examples",
                "OpenAPI 3.0 spec",
                "OAuth2 / AI-agent provisioning",
                "Optional auto-refill",
                "Monthly spend cap controls",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-zinc-300">
                  <svg
                    className="w-4 h-4 text-blue-400 mt-0.5 shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="px-8 py-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/get-key"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 transition-colors text-sm"
              >
                Get your free API key
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-6 py-3 transition-colors text-sm"
              >
                View quickstart guide
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Token usage table ── */}
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Divider />
        <SectionLabel>Token usage</SectionLabel>
        <h2 className="text-2xl font-bold text-white mb-2">
          How many tokens does a request use?
        </h2>
        <p className="text-zinc-400 mb-8">
          Token costs scale with the complexity of the request. Most developers
          start with free credits to understand their usage patterns before
          topping up.
        </p>

        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800">
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Request type
                </th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Tokens
                </th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Yield per $20
                </th>
              </tr>
            </thead>
            <tbody className="bg-zinc-950 divide-y divide-zinc-800/60">
              {usageRows.map((row) => (
                <tr key={row.action} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="px-5 py-4 text-zinc-200 font-medium">
                    {row.action}
                  </td>
                  <td className="px-5 py-4 text-right text-zinc-400 font-mono">
                    {row.tokens}
                  </td>
                  <td className="px-5 py-4 text-right text-blue-400 font-medium">
                    {row.yield}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm text-zinc-500">
          Base rate: 1M tokens = $20. Token counts are per API call, not per
          ticker. Batch endpoints are the most efficient way to analyze large
          universes.
        </p>
      </section>

      {/* ── Enterprise ── */}
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Divider />
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="flex-1">
              <SectionLabel>Enterprise</SectionLabel>
              <h2 className="text-2xl font-bold text-white mb-3">
                10M+ tokens / month?
              </h2>
              <p className="text-zinc-400 mb-6">
                High-volume users get committed-use discounts, dedicated rate
                limits, and priority support.
              </p>
              <ul className="space-y-2">
                {[
                  "100+ req / min dedicated rate limits",
                  "Committed-use volume discounts",
                  "Priority support & SLA guarantees",
                  "Custom integration assistance",
                  "Dedicated onboarding",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-zinc-300">
                    <svg
                      className="w-4 h-4 text-zinc-500 shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="sm:shrink-0">
              <a
                href="mailto:contact@riskmodels.net?subject=Enterprise%20Pricing"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-600 hover:border-zinc-400 text-zinc-200 hover:text-white font-medium px-6 py-3 transition-colors text-sm"
              >
                Contact sales
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Rate limits ── */}
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Divider />
        <SectionLabel>Rate limits</SectionLabel>
        <h2 className="text-2xl font-bold text-white mb-2">
          Requests per minute
        </h2>
        <p className="text-zinc-400 mb-8">
          Limits are per API key and reset every minute.
        </p>

        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800">
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Tier
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Rate limit
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Best for
                </th>
              </tr>
            </thead>
            <tbody className="bg-zinc-950 divide-y divide-zinc-800/60">
              {rateLimitRows.map((row) => (
                <tr key={row.tier} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="px-5 py-4 text-zinc-200 font-medium">
                    {row.tier}
                  </td>
                  <td className="px-5 py-4 font-mono text-blue-400">
                    {row.limit}
                  </td>
                  <td className="px-5 py-4 text-zinc-400">{row.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="mx-auto max-w-4xl px-6 py-8 pb-24">
        <Divider />
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="text-2xl font-bold text-white mb-10">
          Common questions
        </h2>

        <div className="space-y-8">
          {faqs.map((item) => (
            <div
              key={item.q}
              className="border-l-2 border-zinc-800 pl-6"
            >
              <h3 className="text-base font-semibold text-white mb-2">
                {item.q}
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <h3 className="text-xl font-bold text-white mb-2">
            Ready to start?
          </h3>
          <p className="text-zinc-400 mb-6 text-sm">
            Get your free API key in under a minute. No password required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/get-key"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 transition-colors text-sm"
            >
              Get free API key
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
            <Link
              href="/docs/api"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-6 py-3 transition-colors text-sm"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
