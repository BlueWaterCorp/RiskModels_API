// app/pricing/page.tsx
// Developer pricing page for riskmodels.app
// Mirrors the developer pricing from riskmodels.net/pricing?tab=developers

import type { Metadata } from "next";
import Link from "next/link";
import PricingEstimator from "@/components/pricing/PricingEstimator";
import PricingFAQ, { type PricingFaqItem } from "@/components/pricing/PricingFAQ";

export const metadata: Metadata = {
  title: "Pricing — RiskModels API",
  description:
    "Baseline vs Premium: everyday risk checks from $0.001–$0.005/call; Premium unlocks L3 decomposition, portfolio risk indexing, PDF snapshots, and batch analytics. $20 free credits — no subscriptions.",
};

// ─── Data ────────────────────────────────────────────────────────────────────

const baselineRows = [
  {
    endpoint: "Risk metrics / rankings / search",
    cost: "$0.001",
    callsPer20: "20,000",
    tier: "baseline" as const,
  },
  {
    endpoint: "Macro factors / correlations",
    cost: "$0.002",
    callsPer20: "10,000",
    tier: "baseline" as const,
  },
  {
    endpoint: "CLI query",
    cost: "$0.003",
    callsPer20: "6,667",
    tier: "baseline" as const,
  },
  {
    endpoint: "Ticker returns (any history length)",
    cost: "$0.005",
    callsPer20: "4,000",
    tier: "baseline" as const,
  },
];

const premiumRows = [
  {
    endpoint: "L3 risk decomposition",
    cost: "$0.02",
    callsPer20: "1,000",
    tier: "premium" as const,
  },
  {
    endpoint: "Plaid holdings sync",
    cost: "$0.02",
    callsPer20: "1,000",
    tier: "premium" as const,
  },
  {
    endpoint: "Portfolio Risk Index",
    cost: "$0.03",
    callsPer20: "667",
    tier: "premium" as const,
  },
  {
    endpoint: "Batch portfolio analysis",
    cost: "$0.005/pos",
    callsPer20: "varies",
    tier: "premium" as const,
  },
  {
    endpoint: "AI risk analyst (chat)",
    cost: "~$0.003/turn",
    callsPer20: "~6,600",
    tier: "premium" as const,
  },
  {
    endpoint: "PDF risk snapshot",
    cost: "$0.25",
    callsPer20: "80",
    tier: "premium" as const,
  },
];

const tierComparisonRows = [
  {
    aspect: "Typical price band",
    baseline: "$0.001–$0.005 per successful call",
    premium: "From ~$0.02/call; batch per position (min $0.01); PDF snapshot $0.25",
  },
  {
    aspect: "What you get",
    baseline: "Metrics, rankings, search, macro factors, correlations, returns, CLI",
    premium: "L3 decomposition, Portfolio Risk Index, Plaid sync, batch analytics, chat agent, PDF reports",
  },
  {
    aspect: "Best for",
    baseline: "Dashboards, monitoring, light automation, time-series workflows",
    premium: "Agents, quant stacks, portfolio deliverables, heavier analytics",
  },
] as const;

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

const refillTiers = [
  {
    amount: "$20",
    name: "Small",
    audience: "Individual",
    detail: "Adds $20 to your API balance — great for experiments and light scripts.",
    popular: false,
  },
  {
    amount: "$50",
    name: "Growth",
    audience: "Standard",
    detail: "Adds $50 to your API balance — default suggested tier when you enable auto-refill.",
    popular: false,
  },
  {
    amount: "$100",
    name: "Business",
    audience: "Production",
    detail: "Adds $100 to your API balance — fewer interruptions for high-volume workloads.",
    popular: true,
  },
];

const faqs: PricingFaqItem[] = [
  {
    q: "What is the difference between Baseline and Premium?",
    a: "Baseline features ($0.001–$0.005/call) power everyday risk checks and time series — metrics, rankings, macro/correlation endpoints, ticker returns, and CLI access. Premium capabilities unlock deeper L3 decomposition, portfolio-level risk indexing, PDF snapshots, batch portfolio analysis, Plaid holdings sync, and the AI risk analyst chat. Same API key for both; each call is billed at the rate for that endpoint. See the comparison table and per-endpoint tables on this page.",
  },
  {
    q: "Do my free credits expire?",
    a: "Your $20 in free credits never expire. However, your API key requires at least one call every 90 days to stay active. After 90 days of complete inactivity the key is automatically deactivated — not deleted — for security. You can reactivate instantly from your dashboard or by making any API call.",
  },
  {
    q: "What happens when I run out of credits?",
    a: "Auto-refill is off by default when you add a card. With it off, you top up manually and API calls return 402 Payment Required if your balance is too low. If you turn auto-refill on, you pick a refill tier ($20, $50, or $100); when your balance falls below your threshold (default $5), your card is charged for that tier and your API balance is credited. You can disable auto-refill or change tier anytime via your billing settings or PATCH /api/user/billing-config.",
  },
  {
    q: "Can I set a monthly spend cap?",
    a: "Yes. Set a hard cap in your developer dashboard. Once hit, API calls are paused until the next billing cycle and you receive an email notification. You can raise the cap at any time. This prevents surprise bills from runaway scripts or unexpected traffic spikes.",
  },
  {
    q: "Is there a volume discount?",
    a: "If your monthly API spend consistently exceeds $100, email service@riskmodels.app — we can sharpen pricing for steady usage, raise rate limits (100+ req/min), and help you get integrated. We keep it straightforward.",
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-6 pt-12 pb-8 text-center">
        <SectionLabel>Pricing</SectionLabel>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
          Baseline vs Premium — pay as you go
        </h1>
        <p className="text-base text-zinc-200 max-w-2xl mx-auto mb-3 leading-relaxed">
          Baseline features ($0.001–$0.005/call) power everyday risk checks and time series. Premium
          capabilities unlock deeper L3 decomposition, portfolio-level risk indexing, PDF snapshots,
          and batch analytics — perfect for agents and power users.
        </p>
        <p className="text-sm text-zinc-500 max-w-2xl mx-auto mb-2 leading-snug">
          Built for{" "}
          <span className="text-blue-400 font-semibold">agentic</span> workflows — the Python SDK
          handles ticker resolution, semantic field normalization, and portfolio aggregation
          client-side. Responses include latency headers like{" "}
          <code className="text-xs text-zinc-300 bg-zinc-800 px-1 rounded">
            X-Agent-Decision-Latency-Ms
          </code>
          .
        </p>
        <p className="text-sm text-zinc-500 max-w-2xl mx-auto leading-snug">
          Start free with <span className="text-white font-semibold">$20 in credits</span> — then pay
          per successful call by tier. No subscription, no seat fees.
        </p>
      </section>

      {/* ── Baseline vs Premium comparison ── */}
      <section className="mx-auto max-w-4xl px-6 pb-8">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400 mb-2 text-center">
          At a glance
        </p>
        <h2 className="text-lg font-bold text-white mb-3 text-center">Compare tiers</h2>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-md overflow-x-auto">
          <table className="w-full text-sm min-w-[320px]">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800/80">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 w-[28%]">
                  &nbsp;
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-300">
                  Baseline
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-blue-400">
                  Premium
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {tierComparisonRows.map((row) => (
                <tr key={row.aspect} className="hover:bg-zinc-800/20 transition-colors align-top">
                  <td className="px-4 py-3 font-medium text-zinc-400 text-xs sm:text-sm whitespace-nowrap sm:whitespace-normal">
                    {row.aspect}
                  </td>
                  <td className="px-4 py-3 text-zinc-300 text-xs sm:text-sm leading-snug">
                    {row.baseline}
                  </td>
                  <td className="px-4 py-3 text-blue-100/90 text-xs sm:text-sm leading-snug">
                    {row.premium}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-center text-[11px] text-zinc-500 max-w-2xl mx-auto leading-snug">
          One account covers both — you are charged per call based on the endpoint&apos;s tier.
        </p>
      </section>

      {/* ── Main pricing card ── */}
      <section className="mx-auto max-w-4xl px-6 pb-10 pt-0">
        <div className="rounded-xl border border-blue-500/30 bg-zinc-900/40 backdrop-blur-md overflow-hidden shadow-[0_0_60px_-20px_rgba(59,130,246,0.25)]">
          {/* Card header */}
          <div className="px-5 pt-5 pb-4 border-b border-zinc-800/80">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-0">
                  Pay-as-you-go · same key, tiered pricing
                </p>
                <div className="space-y-0.5 mt-0.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-zinc-400">Baseline</span>
                    <span className="text-2xl font-bold text-white tabular-nums">$0.001</span>
                    <span className="text-zinc-500 text-sm">/ request</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-blue-400">Premium</span>
                    <span className="text-2xl font-bold text-white tabular-nums">$0.02</span>
                    <span className="text-zinc-500 text-sm">/ request</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-1 sm:mt-0">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 border border-green-400/20 rounded-md px-2 py-0.5 backdrop-blur-sm">
                  <svg
                    className="w-3 h-3 shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  $20 free credits after card setup
                </span>
                <p className="text-[11px] text-zinc-500">Credits never expire</p>
              </div>
            </div>
          </div>

          {/* Includes */}
          <div className="px-5 py-4 border-b border-zinc-800/80">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">
              Included with every account
            </p>
            <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                "Full access to all ~3,000 US equities",
                "41-factor ERM3 risk decompositions",
                "Hedge ratios at L1 / L2 / L3",
                "Historical data back to 2006",
                "REST API + CLI access",
                "TypeScript, Python, cURL examples",
                "OpenAPI 3.0 spec",
                "OAuth2 / AI-agent provisioning",
                "Optional auto-refill (off by default)",
                "Monthly spend cap controls",
              ].map((item) => (
                <li key={item} className="flex items-start gap-1.5 text-sm text-zinc-300 leading-snug">
                  <svg
                    className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0"
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
          <div className="px-5 py-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Link
                href="/get-key"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 transition-colors text-sm"
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
                className="inline-flex items-center justify-center rounded-md border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-5 py-2.5 transition-colors text-sm"
              >
                View quickstart guide
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ── Pricing tables + estimator ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <SectionLabel>Baseline vs Premium</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">
          Per-endpoint prices
        </h2>
        <p className="text-sm text-zinc-400 mb-5 max-w-3xl leading-snug">
          Calls are either <span className="text-zinc-200 font-medium">Baseline</span> or{" "}
          <span className="text-blue-400 font-medium">Premium</span> — flat per successful request
          (batch: per position, minimum $0.01). No token math on data endpoints. Use the estimator
          for a monthly rough cut, then use the tables for exact rates. Advanced users: install{" "}
          <code className="text-xs text-zinc-300 bg-zinc-800 px-1 rounded">riskmodels-py[xarray]</code>{" "}
          for multi-dimensional factor cube workflows (see{" "}
          <Link
            href="/docs/methodology#xarray-cube"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            Methodology
          </Link>
          ).
        </p>

        <div className="mb-6">
          <PricingEstimator />
        </div>

        <p className="text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-widest">
          Baseline — Data Access
        </p>
        <div className="max-w-4xl mx-auto rounded-lg border border-zinc-800/80 overflow-hidden bg-zinc-900/30 backdrop-blur-md mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800/80">
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Endpoint
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Cost per call
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Calls per $20
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {baselineRows.map((row) => (
                <tr key={row.endpoint} className="hover:bg-zinc-800/25 transition-colors">
                  <td className="px-4 py-2 font-medium text-zinc-200">{row.endpoint}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">
                    {row.cost}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300 font-medium text-xs">
                    {row.callsPer20}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs font-semibold text-blue-400 mb-2 uppercase tracking-widest">
          Premium — Analytics &amp; Deliverables
        </p>
        <div className="max-w-4xl mx-auto rounded-lg border border-zinc-800/80 overflow-hidden bg-zinc-900/30 backdrop-blur-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800/80">
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Endpoint
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Cost per call
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Calls per $20
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {premiumRows.map((row) => (
                <tr key={row.endpoint} className="hover:bg-zinc-800/25 transition-colors">
                  <td className="px-4 py-2 font-medium text-blue-100">
                    {row.endpoint}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-blue-400/90">
                    {row.cost}
                  </td>
                  <td className="px-4 py-2 text-right text-blue-400/80 font-medium text-xs">
                    {row.callsPer20}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-zinc-500 max-w-4xl mx-auto leading-snug">
          All prices are per successful API call. Cached responses are free. Batch endpoints charge
          per position with a $0.01 minimum.
        </p>
      </section>

      <SectionDivider />

      {/* ── Starter gift + Credit packs ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <SectionLabel>Auto-refill</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">Credits & refills</h2>
        <p className="text-sm text-zinc-400 mb-5 max-w-3xl leading-snug">
          Auto-refill stays <span className="text-zinc-200 font-medium">off</span> until you turn
          it on. When enabled, your card is charged for the pack you select whenever your balance
          drops below your threshold (default{" "}
          <span className="text-zinc-200 font-mono">$5</span>).
        </p>

        {/* Starter gift — free $20 credits */}
        <div
          className="mb-5 rounded-xl border border-blue-400/35 bg-zinc-900/35 backdrop-blur-md px-4 py-4 sm:px-5 sm:py-4 relative overflow-hidden
            shadow-[0_0_48px_-8px_rgba(59,130,246,0.45),0_0_1px_0_rgba(96,165,250,0.5)]"
        >
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/[0.08] via-transparent to-transparent"
            aria-hidden
          />
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-1">
                Starter gift
              </p>
              <p className="text-xl sm:text-2xl font-bold text-white mb-0.5">
                $20 in free credits
              </p>
              <p className="text-xs text-zinc-400 max-w-xl leading-snug">
                Add a card to activate your key — we credit <span className="text-zinc-200">$20</span>{" "}
                instantly. No upfront charge. This is not a refill pack; it&apos;s our welcome
                balance so you can ship an agentic integration before you spend.
              </p>
            </div>
            <Link
              href="/get-key"
              className="shrink-0 inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 text-sm transition-colors"
            >
              Claim credits
            </Link>
          </div>
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">
          Credit packs (paid refills)
        </p>
        <div className="flex flex-col lg:flex-row gap-3 max-w-4xl mx-auto">
          {refillTiers.map((tier) => (
            <div
              key={tier.amount}
              className={`relative flex-1 rounded-lg border bg-zinc-900/40 backdrop-blur-md p-4 flex flex-col min-h-0 ${
                tier.popular
                  ? "border-blue-500/50 ring-1 ring-blue-500/20 shadow-[0_0_40px_-12px_rgba(59,130,246,0.35)]"
                  : "border-zinc-800/80"
              }`}
            >
              {tier.popular ? (
                <div className="absolute top-0.5 right-0.5 rounded-bl-md rounded-tr-lg bg-gradient-to-r from-blue-600 to-blue-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md">
                  Most popular
                </div>
              ) : null}
              <p className="text-2xl font-bold text-white mb-0 pr-20 lg:pr-0 tabular-nums">{tier.amount}</p>
              <p className="text-xs font-semibold text-blue-400 mb-0">
                {tier.name}{" "}
                <span className="text-zinc-500 font-normal">· {tier.audience}</span>
              </p>
              <p className="text-xs text-zinc-400 leading-snug mt-1.5 flex-1">{tier.detail}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-zinc-500 max-w-4xl mx-auto leading-snug">
          Manage auto-refill, tier, and threshold with{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">GET</code>{" "}
          /{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">PATCH</code>{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-blue-300">
            /api/user/billing-config
          </code>{" "}
          (authenticated).
        </p>
      </section>

      <SectionDivider />

      {/* ── Enterprise ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/35 backdrop-blur-md p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <SectionLabel>High volume</SectionLabel>
              <h2 className="text-xl font-bold text-white mb-1">
                $100+ / month API spend?
              </h2>
              <p className="text-sm text-zinc-400 mb-3 leading-snug">
                If you&apos;re consistently in that range, mail{" "}
                <a
                  href="mailto:service@riskmodels.app?subject=High%20volume%20pricing"
                  className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                >
                  service@riskmodels.app
                </a>
                — we can raise rate limits, sharpen pricing for steady usage, and help you wire
                things up. We&apos;ll reply and keep it simple.
              </p>
              <ul className="space-y-1.5">
                {[
                  "Higher rate limits (100+ req/min) when you need them",
                  "Volume pricing if you're consistently heavy",
                  "Straightforward support—real replies, not a ticket black hole",
                  "Help integrating (batch flows, auth, whatever you're stuck on)",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-1.5 text-sm text-zinc-300 leading-snug">
                    <svg
                      className="w-3.5 h-3.5 text-zinc-500 shrink-0"
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
                href="mailto:service@riskmodels.app?subject=High%20volume%20pricing"
                className="inline-flex items-center gap-2 rounded-md border border-zinc-600 hover:border-zinc-400 text-zinc-200 hover:text-white font-medium px-5 py-2.5 transition-colors text-sm"
              >
                Email us
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

      <SectionDivider />

      {/* ── Rate limits ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <SectionLabel>Rate limits</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">Requests per minute</h2>
        <p className="text-sm text-zinc-400 mb-5 leading-snug">
          Limits are per API key and reset every minute.
        </p>

        <div className="max-w-4xl mx-auto rounded-lg border border-zinc-800/80 overflow-hidden bg-zinc-900/30 backdrop-blur-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800/80">
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Tier
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Rate limit
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Best for
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rateLimitRows.map((row) => (
                <tr key={row.tier} className="hover:bg-zinc-800/25 transition-colors">
                  <td className="px-4 py-2 text-zinc-200 font-medium text-sm">{row.tier}</td>
                  <td className="px-4 py-2 font-mono text-blue-400 text-xs">{row.limit}</td>
                  <td className="px-4 py-2 text-zinc-400 text-sm">{row.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SectionDivider />

      {/* ── FAQ ── */}
      <section className="mx-auto max-w-4xl px-6 py-10 pb-12">
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">Common questions</h2>
        <p className="text-sm text-zinc-500 mb-3 max-w-2xl">
          Baseline vs Premium, credits, billing, and security — start with the first item for the
          tier overview.
        </p>

        <PricingFAQ items={faqs} />

        {/* Bottom CTA */}
        <div className="mt-8 max-w-4xl mx-auto rounded-xl border border-zinc-800/80 bg-zinc-900/35 backdrop-blur-md p-5 text-center">
          <h3 className="text-lg font-bold text-white mb-1">Ready to start?</h3>
          <p className="text-zinc-400 mb-4 text-xs leading-snug">
            Get your free API key in under a minute. No password required.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link
              href="/get-key"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 transition-colors text-sm"
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
              className="inline-flex items-center justify-center rounded-md border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-5 py-2.5 transition-colors text-sm"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
