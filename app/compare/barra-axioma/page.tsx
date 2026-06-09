// app/compare/barra-axioma/page.tsx
// SEO comparison page: where RiskModels fits next to Barra & Axioma.
// Framed as a three-tier spectrum (DIY ↔ RiskModels ↔ enterprise), not a
// head-to-head — RiskModels is a different delivery model for a different
// buyer, never a "cheaper Barra." Claims describe what RiskModels does, not
// what competitors can't. Barra is an MSCI trademark; Axioma is SimCorp's —
// named here under nominative fair use.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Barra & Axioma Alternative — Equity Risk Decomposition by API",
  description:
    "How RiskModels fits next to Barra and Axioma: an API-native equity risk layer that decomposes any US stock, fund, portfolio, or 13F into market, sector, subsector, and residual — with ETF hedge ratios in one call. Built for developers, RIAs, family offices, and small institutional teams — not a replacement for an enterprise risk platform.",
  alternates: { canonical: "/compare/barra-axioma" },
  openGraph: {
    title: "Barra & Axioma Alternative — Equity Risk Decomposition by API",
    description:
      "An API-native equity risk layer that decomposes any US stock, fund, portfolio, or 13F into market, sector, subsector, and residual — with ETF hedge ratios in one call.",
    url: "https://riskmodels.app/compare/barra-axioma",
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

const TIERS = [
  {
    name: "Build it yourself",
    sub: "Fama-French · open source · in-house",
    body:
      "Open factor libraries and your own regressions. Free and flexible — but you own the data pipeline, the model maintenance, and the work of explaining what each position is really betting on.",
    highlight: false,
  },
  {
    name: "RiskModels",
    sub: "API-native · pay-per-call",
    body:
      "Holdings-level decomposition into market, sector, subsector, and residual — plus the ETF hedge ratios to act on it — from one API call. No platform to stand up, no seats, no enterprise contract.",
    highlight: true,
  },
  {
    name: "Enterprise risk platforms",
    sub: "Barra · Axioma",
    body:
      "Broad factor libraries, covariance engines, optimizers, reporting, governance, model history, and vendor support — built for large institutional risk teams. The trusted institutional standard.",
    highlight: false,
  },
] as const;

const DOES = [
  {
    h: "Additive four-layer decomposition",
    p: "Every position splits into market, sector, subsector, and residual — and they add up: market_er + sector_er + subsector_er + residual_er ≈ 1. No hidden factors.",
  },
  {
    h: "Executable ETF hedge ratios",
    p: "The headline output is a trade, not just an exposure: dollars of factor ETF per $1 of stock, computed from the same regression that explains the risk.",
  },
  {
    h: "API-native and agent-callable",
    p: "JSON in, hedge ratios out — from your app, notebook, or agent. Add the MCP connector to Claude, Cursor, or VS Code with no terminal and no API key.",
  },
  {
    h: "Pay per call",
    p: "Start with $20 in free credits, then pay per successful call. No seats, no platform license, no enterprise lock-in.",
  },
  {
    h: "Broad, deep coverage",
    p: "About 3,000 US equities with daily history back to 2006 — single stocks, funds, portfolios, and disclosed 13F books.",
  },
  {
    h: "Published methodology",
    p: "Open research and reproducible decomposition logic with real citations (Frisch-Waugh-Lovell, Cremers-Petajisto, Grinold-Kahn). The model is documented on riskmodels.org.",
  },
] as const;

const FOR = [
  "RIAs and family offices that want holdings-level equity risk without standing up an enterprise platform",
  "Emerging managers and small hedge funds",
  "Allocators doing manager, fund, and 13F look-through",
  "Fintech apps and AI finance agents embedding risk decomposition",
  "Developers and quants prototyping before committing to enterprise tooling",
] as const;

const ENTERPRISE_INSTEAD = [
  "You need a full portfolio-construction optimizer ecosystem",
  "You need multi-asset-class coverage beyond US equities",
  "A large risk team requires governance, audit trails, long model history, and dedicated vendor support",
] as const;

export default function CompareBarraAxiomaPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-6 pt-12 pb-8 text-center">
        <SectionLabel>Compare</SectionLabel>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
          Where RiskModels fits next to Barra and Axioma
        </h1>
        <p className="text-base text-zinc-300 max-w-2xl mx-auto mb-3 leading-relaxed">
          Barra and Axioma are the institutional standard — enterprise risk
          infrastructure for large risk teams. RiskModels is a different
          delivery model for a different buyer:{" "}
          <span className="text-white font-semibold">
            equity risk decomposition by API
          </span>
          , with ETF hedge ratios you can trade, for any US stock, fund,
          portfolio, or 13F.
        </p>
        <p className="text-sm text-zinc-500 max-w-2xl mx-auto leading-snug">
          It is not a replacement for an enterprise risk platform. It is the
          API-native risk layer for teams that need holdings-level
          decomposition without one.
        </p>
      </section>

      {/* ── Three-tier spectrum ── */}
      <section className="mx-auto max-w-5xl px-6 pb-10">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400 mb-2 text-center">
          The spectrum
        </p>
        <h2 className="text-lg font-bold text-white mb-5 text-center">
          From do-it-yourself to enterprise — and the gap in the middle
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-xl border bg-zinc-900/40 backdrop-blur-md p-5 ${
                tier.highlight
                  ? "border-blue-500/50 ring-1 ring-blue-500/20 shadow-[0_0_40px_-12px_rgba(59,130,246,0.35)]"
                  : "border-zinc-800/80"
              }`}
            >
              {tier.highlight ? (
                <div className="absolute top-0.5 right-0.5 rounded-bl-md rounded-tr-lg bg-gradient-to-r from-blue-600 to-blue-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md">
                  This is us
                </div>
              ) : null}
              <p
                className={`text-base font-bold mb-0.5 ${
                  tier.highlight ? "text-white" : "text-zinc-200"
                }`}
              >
                {tier.name}
              </p>
              <p
                className={`text-[11px] font-semibold uppercase tracking-widest mb-2.5 ${
                  tier.highlight ? "text-blue-400" : "text-zinc-500"
                }`}
              >
                {tier.sub}
              </p>
              <p className="text-sm text-zinc-400 leading-relaxed flex-1">
                {tier.body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-zinc-500 max-w-2xl mx-auto leading-snug">
          The middle tier is the gap: real, holdings-level decomposition for
          teams that don&apos;t need — or can&apos;t justify — a full enterprise
          risk platform.
        </p>
      </section>

      <SectionDivider />

      {/* ── What RiskModels does ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <SectionLabel>What RiskModels does</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">
          Decomposition you can act on, by API
        </h2>
        <p className="text-sm text-zinc-400 mb-6 max-w-3xl leading-snug">
          The distinctive output isn&apos;t a factor exposure — it&apos;s a
          tradable one. Each layer maps to an ETF, and each ETF comes back with
          a hedge ratio in dollars.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {DOES.map((item) => (
            <div
              key={item.h}
              className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-md p-4"
            >
              <p className="text-sm font-semibold text-white mb-1">{item.h}</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{item.p}</p>
            </div>
          ))}
        </div>
      </section>

      <SectionDivider />

      {/* ── Who it's for ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <SectionLabel>Who it&apos;s for</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-4">
          Between DIY factor libraries and enterprise platforms
        </h2>
        <ul className="space-y-2">
          {FOR.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-sm text-zinc-300 leading-snug"
            >
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
      </section>

      <SectionDivider />

      {/* ── When an enterprise platform is the right call ── */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <SectionLabel>When to choose an enterprise platform</SectionLabel>
        <h2 className="text-xl font-bold text-white mb-1">
          Barra and Axioma are the right call when&hellip;
        </h2>
        <p className="text-sm text-zinc-400 mb-4 max-w-3xl leading-snug">
          We&apos;re honest about the boundary. If any of these describe you, an
          enterprise risk platform is built for exactly that:
        </p>
        <ul className="space-y-2">
          {ENTERPRISE_INSTEAD.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-sm text-zinc-400 leading-snug"
            >
              <span className="mt-0.5 text-zinc-600">&bull;</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-zinc-300 leading-relaxed max-w-3xl">
          For everyone in the gap — same problem domain, different delivery
          model, different buyer, different workflow.
        </p>
      </section>

      <SectionDivider />

      {/* ── CTA ── */}
      <section className="mx-auto max-w-4xl px-6 py-10 pb-12">
        <div className="rounded-xl border border-blue-500/30 bg-zinc-900/40 backdrop-blur-md p-6 text-center shadow-[0_0_60px_-20px_rgba(59,130,246,0.25)]">
          <h2 className="text-lg font-bold text-white mb-1">
            Try the decomposition on a ticker you own
          </h2>
          <p className="text-zinc-400 mb-5 text-sm leading-snug max-w-xl mx-auto">
            Get a free API key in under a minute, or read the methodology behind
            the model. $20 in credits, no subscription.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link
              href="/get-key"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 transition-colors text-sm"
            >
              Get free API key
            </Link>
            <Link
              href="/docs/methodology"
              className="inline-flex items-center justify-center rounded-md border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-5 py-2.5 transition-colors text-sm"
            >
              Read the methodology
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-md border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-medium px-5 py-2.5 transition-colors text-sm"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
