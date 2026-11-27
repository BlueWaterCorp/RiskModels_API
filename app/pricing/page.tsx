// Pricing: request prices, credit, and annual licenses.

import type { Metadata } from "next";
import Link from "next/link";
import PricingFAQ, { type PricingFaqItem } from "@/components/pricing/PricingFAQ";
import { SectionHead } from "@/components/site/SectionHead";
import { StackedRows } from "@/components/site/StackedRows";
import { getCapabilityById } from "@/lib/agent/capabilities";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing",
  description:
    "Pay per request from $0.005; $20 of credit at sign-in with no card. Annual licenses: Desk $50,000, Firm $150,000, Production $250,000.",
};

const baselineRows = [
  {
    endpoint: "Risk metrics / rankings / search",
    cost: "$0.005",
    callsPer20: "4,000",
  },
  {
    endpoint: "Macro factors / correlations",
    cost: "$0.005–$0.01",
    callsPer20: "2,000–4,000",
  },
  {
    endpoint: "CLI query",
    cost: "$0.015",
    callsPer20: "1,333",
  },
  {
    endpoint: "Ticker returns (daily L3 HR/ER; $0.02 for 1y + $0.01/extra year, up to 15y)",
    cost: "$0.02+",
    callsPer20: "1,000 (1y)",
  },
];

const premiumRows = [
  {
    endpoint: "Recommended hedge level",
    cost: "$0.02 + $0.01/extra year",
    callsPer20: "1,000 (1y)",
  },
  {
    endpoint: "Recommended hedge level, batch (25% off single)",
    cost: "$0.015/pos",
    callsPer20: "varies",
  },
  {
    endpoint: "L3 risk decomposition",
    cost: "$0.04",
    callsPer20: "500",
  },
  {
    endpoint: "Plaid holdings sync",
    cost: "$0.10",
    callsPer20: "200",
  },
  {
    endpoint: "Portfolio Risk Index",
    cost: "$0.15",
    callsPer20: "133",
  },
  {
    endpoint: "Long/short portfolio exposure (up to 25 names / above 25)",
    cost: "$0.25 / $1.00",
    callsPer20: "80 / 20",
  },
  {
    endpoint: "Exposure history feed, month-end (up to 25 names / above 25)",
    cost: "$1.25 / $5.00",
    callsPer20: "16 / 4",
  },
  {
    endpoint: "Exposure history feed, daily (up to 25 names / above 25)",
    cost: "$2.50 / $10.00",
    callsPer20: "8 / 2",
  },
  {
    endpoint: "Batch portfolio analysis",
    cost: "$0.015/pos",
    callsPer20: "varies",
  },
  {
    endpoint: "AI risk analyst (chat)",
    cost: "~$0.015/turn",
    callsPer20: "~1,300",
  },
  {
    endpoint: "PDF risk snapshot",
    cost: "$1.25",
    callsPer20: "16",
  },
];

const licenseRows: Array<[string, string, string, string]> = [
  ["Price per year", "$50,000", "$150,000", "$250,000"],
  ["Use", "One team, one strategy", "Unlimited internal use across the firm", "Systematic production dependency"],
  ["Universe", "Standard universe: the 3,000 largest US stocks by market capitalization, with dated membership for any past trading day", "Full published universe", "Full published universe"],
  ["Support", "Named contact; onboarding for the desk workflow", "Named contact; onboarding for research systems", "Incident contact; onboarding for production pipelines and entitlement review"],
  ["Availability", "Higher request limits than pay-per-request", "SLA on availability of the public API", "Contracted SLA"],
  ["Model versions", "Notice of scheduled deprecations", "Deprecation policy with a stated notice window", "Version pinning of model vintages; minimum notice window"],
];

const licenseContacts = [
  ["Desk", "mailto:service@riskmodels.app?subject=Desk%20license"],
  ["Firm", "mailto:service@riskmodels.app?subject=Firm%20license"],
  ["Production", "mailto:service@riskmodels.app?subject=Production%20license"],
] as const;

const faqs: PricingFaqItem[] = [
  {
    q: "I already have a key. Do my rates change?",
    a: "Keys that recorded a paid call before 14 August 2026 keep the prior per-endpoint rates through 31 December 2026. After that date every key bills the current schedule. New keys are billed at the current schedule from the first call. Cached responses remain free.",
  },
  {
    q: "Do my free credits expire?",
    a: "Your $20 in free credits stay on the account until spent. Your API key requires at least one call every 90 days to stay active. After 90 days of complete inactivity the key is automatically deactivated for security and stays on the account. You can reactivate instantly from your dashboard or by making any API call.",
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
    q: "Is my API data encrypted?",
    a: "Yes, in transit (TLS) and at rest. API keys and connector tokens are stored only as SHA-256 hashes, checked with timing-safe comparison. Holdings you send to the API are used to compute the response and are not stored in our database; some responses are cached for up to 24 hours. Portfolios you save in your RiskModels account are encrypted per portfolio with data keys wrapped by Google Cloud KMS. Details are in the privacy policy at /privacy.",
  },
];

/** Price of one request, read from the capability list that billing uses. */
function unitPrice(id: string): number {
  const cost = getCapabilityById(id)?.pricing.cost_usd;
  if (typeof cost !== "number") throw new Error(`pricing: no price for capability ${id}`);
  return cost;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const TRADING_DAYS = 21;

/** Three worked months. Usage figures are illustrations chosen for round arithmetic, not customer data. */
function monthlyExamples() {
  const metrics = unitPrice("metrics");
  const exposure = unitPrice("portfolio-exposure");
  const returns = unitPrice("ticker-returns");
  const snapshot = unitPrice("portfolio-risk-snapshot");
  return [
    {
      name: "Watch list",
      usage: `Latest metrics for 50 stocks, once each trading day`,
      sum: `50 × ${TRADING_DAYS} × $${metrics}`,
      total: 50 * TRADING_DAYS * metrics,
    },
    {
      name: "One long/short book",
      usage: `Exposure of a book of up to 25 names each trading day, and one PDF snapshot a week`,
      sum: `${TRADING_DAYS} × ${usd(exposure)} + 4 × ${usd(snapshot)}`,
      total: TRADING_DAYS * exposure + 4 * snapshot,
    },
    {
      name: "Research pull",
      usage: `One year of daily returns for 500 stocks, once, plus latest metrics for the same 500 each trading day`,
      sum: `500 × ${usd(returns)} + 500 × ${TRADING_DAYS} × $${metrics}`,
      total: 500 * returns + 500 * TRADING_DAYS * metrics,
    },
  ];
}

function PriceTable({ caption, rows }: { caption: string; rows: typeof baselineRows }) {
  return (
    <>
    <StackedRows
      className="mt-8"
      caption={caption}
      rows={rows.map((r) => ({
        key: r.endpoint,
        title: r.endpoint,
        lines: [
          /^[\d,~ /–]+$/.test(r.callsPer20)
            ? `${r.cost} · ${r.callsPer20} requests per $20`
            : `${r.cost} · requests per $20: ${r.callsPer20}`,
        ],
      }))}
    />
    <div className="rm-scroll-x mt-6 hidden sm:block">
      <table className="rm-table min-w-[34rem]">
        <caption className="rm-label pb-3 text-left">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col" className="num">Price</th>
            <th scope="col" className="num">Requests per $20</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.endpoint}>
              <td>{r.endpoint}</td>
              <td className="num">{r.cost}</td>
              <td className="num">{r.callsPer20}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function PricingPage() {
  const examples = monthlyExamples();
  return (
    <div className="rm-page pb-12">
      <header className="pb-4 pt-8 sm:pt-10">
        <p className="rm-label">Pricing</p>
        <h1 className="rm-h1 mt-4 max-w-3xl">Pay per request. Annual licenses for firms.</h1>
        <p className="rm-lede mt-4 max-w-2xl">
          A new account receives $20 of credit at sign-in, with no card. After that, each successful request
          draws on prepaid credit at the prices below. There is no subscription and no seat fee.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/get-key" className="rm-btn">
            Get an API key
          </Link>
          <a href="#licenses" className="rm-btn-ghost">
            Annual licenses
          </a>
        </div>
      </header>

      <section className="rm-section" aria-labelledby="prices">
        <SectionHead n="01" label="Self-serve API · request prices" title="What each request costs" id="prices">
          <p>
            Only successful requests are billed. A cached response is free. Batch requests are charged per
            position with a $0.03 minimum. Ticker returns and the recommended hedge level add $0.01 for each
            year of history beyond the first.
          </p>
        </SectionHead>
        <PriceTable caption="Data access, from $0.005" rows={baselineRows} />
        <PriceTable caption="Analytics and deliverables, from $0.02" rows={premiumRows} />
        <p className="rm-small mt-4">
          Keys that recorded a paid request before 14 August 2026 keep their earlier prices through 31 December
          2026. Every endpoint and its price is also in the{" "}
          <Link href="/api-reference" className="rm-link">
            API reference
          </Link>
          .
        </p>

        <StackedRows
          className="mt-10"
          caption="Three example months"
          rows={examples.map((e) => ({
            key: e.name,
            title: `${e.name}: ${usd(e.total)} a month`,
            lines: [<span key="u" className="font-sans">{e.usage}</span>, e.sum],
          }))}
        />
        <div className="rm-scroll-x mt-8 hidden sm:block">
          <table className="rm-table min-w-[38rem]">
            <caption className="rm-label pb-3 text-left">Three example months</caption>
            <thead>
              <tr>
                <th scope="col">Example</th>
                <th scope="col">Requests</th>
                <th scope="col">Arithmetic</th>
                <th scope="col" className="num">Month</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td>{e.usage}</td>
                  <td className="rm-mono text-[13px]">{e.sum}</td>
                  <td className="num">{usd(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rm-small mt-4">
          These are illustrations at {TRADING_DAYS} trading days a month. Repeat
          requests served from cache would lower each figure.
        </p>
      </section>

      <section className="rm-section" aria-labelledby="credit">
        <SectionHead n="02" label="Self-serve API · credit" title="Credit, top-ups and limits" id="credit">
          <p>
            The $20 of sign-in credit stays on the account until it is spent. Top-ups are $20, $50 or $100. Automatic refill is off
            until you turn it on; when on, the card is charged for the chosen amount when the balance falls
            below a threshold (default $5). With refill off, a request made on an empty balance returns{" "}
            <code className="rm-mono">402</code>.
          </p>
        </SectionHead>
        <StackedRows
          className="mt-8"
          caption="Rate limits"
          rows={[
            { key: "standard", title: "Standard", lines: ["30 requests per minute · every key by default"] },
            {
              key: "raised",
              title: "Raised",
              lines: [
                "100 or more requests per minute",
                <span key="r" className="font-sans">
                  By request, for steady spend above $100 a month:{" "}
                  <a href="mailto:service@riskmodels.app?subject=High%20volume%20pricing" className="rm-link">
                    service@riskmodels.app
                  </a>
                </span>,
              ],
            },
          ]}
        />
        <div className="rm-scroll-x mt-6 hidden sm:block">
          <table className="rm-table min-w-[30rem]">
            <thead>
              <tr>
                <th scope="col">Rate limit</th>
                <th scope="col" className="num">Requests per minute</th>
                <th scope="col">Applies to</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Standard</td>
                <td className="num">30</td>
                <td>Every key by default</td>
              </tr>
              <tr>
                <td>Raised</td>
                <td className="num">100 or more</td>
                <td>
                  By request, for steady spend above $100 a month:{" "}
                  <a href="mailto:service@riskmodels.app?subject=High%20volume%20pricing" className="rm-link">
                    service@riskmodels.app
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="rm-section" aria-labelledby="licenses">
        <span id="licences" aria-hidden="true" />
        <SectionHead n="03" label="Institutional · annual licenses" title="Desk, Firm and Production" id="licenses">
          <p>
            Annual licenses are for teams that need a named contact, a service level, or a fixed model
            version. Service levels and usage rights are defined in the signed agreement.
          </p>
        </SectionHead>
        <div className="mt-8 space-y-8 sm:hidden">
          {licenseContacts.map(([name, href], t) => (
            <div key={name}>
              <h3 className="rm-h3">
                {name} · <span className="rm-mono">{licenseRows[0][t + 1]}</span> a year
              </h3>
              <dl className="mt-3 border-t border-[var(--rm-ink)]">
                {licenseRows.slice(1).map((row) => (
                  <div key={row[0]} className="border-b border-rule py-2.5">
                    <dt className="rm-label">{row[0]}</dt>
                    <dd className="mt-1 text-sm leading-snug text-ink">{row[t + 1]}</dd>
                  </div>
                ))}
              </dl>
              <a href={href} className="rm-link mt-3 inline-block text-sm">
                Email about {name}
              </a>
            </div>
          ))}
        </div>
        <div className="rm-scroll-x mt-6 hidden sm:block">
          <table className="rm-table min-w-[44rem]">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Desk</th>
                <th scope="col">Firm</th>
                <th scope="col">Production</th>
              </tr>
            </thead>
            <tbody>
              {licenseRows.map(([label, desk, firm, production], i) => (
                <tr key={label}>
                  <th scope="row" className="rm-label align-top">{label}</th>
                  {[desk, firm, production].map((cell, j) => (
                    <td key={j} className={i === 0 ? "rm-num align-top" : "align-top"}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="rm-label align-top">Enquire</th>
                {licenseContacts.map(([name, href]) => (
                  <td key={name}>
                    <a href={href} className="rm-link">
                      Email about {name}
                    </a>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="rm-small mt-4 max-w-3xl">
          A scoped proof of concept on public data is typically $25,000 and is credited toward a Desk or Firm
          license. Manager-research work on holdings is scoped on top of a license. RiskModels provides
          analytics and research tooling, not investment advice or manager recommendations.{" "}
          <a href="mailto:service@riskmodels.app?subject=Institutional%20engagement" className="rm-link">
            Ask about scope
          </a>
          .
        </p>
      </section>

      <section className="rm-section" aria-labelledby="faq">
        <SectionHead n="04" label="Questions" title="Billing questions" id="faq" />
        <div className="mt-6">
          <PricingFAQ items={faqs} />
        </div>
      </section>
    </div>
  );
}
