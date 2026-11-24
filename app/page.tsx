import type { Metadata } from 'next';
import Link from 'next/link';
import { SectionHead } from '@/components/site/SectionHead';
import { TrackedLink } from '@/components/site/TrackedLink';
import { CodeExhibit } from '@/components/site/CodeExhibit';
import { ConnectorSteps } from '@/components/site/ConnectorSteps';
import { FeedTable } from '@/components/site/FeedTable';
import { getCapabilityById } from '@/lib/agent/capabilities';
import { CLI_FIRST_CALL, CURL_FIRST_CALL, PYTHON_FIRST_CALL, SDK_PIP_SPEC } from '@/lib/site/examples';
import { getFeedSample, getHealth, getMetricsExhibit, type MetricsExhibit } from '@/lib/site/live';

export const metadata: Metadata = {
  title: 'RiskModels API — US equity risk decomposition and ETF hedge ratios',
  description:
    'Daily risk decomposition and ETF hedge ratios for about 3,000 US stocks, by REST API, Python SDK, command line and a hosted connector for AI assistants. End-of-day data.',
  alternates: { canonical: '/' },
};

// Live figures are re-read at most once a minute; the page never blocks on them.
export const revalidate = 60;

const ORG_UTM = 'utm_source=riskmodels-app&utm_medium=site&utm_campaign=cross-site';

const CURL = CURL_FIRST_CALL;
const PYTHON = `# pip install "${SDK_PIP_SPEC}"\n${PYTHON_FIRST_CALL}`;
const CLI = `npm install -g riskmodels@latest\n${CLI_FIRST_CALL}`;

/** ETFs the model hedges with, counted from GET /api/data/etf/universe on the date given. */
const HEDGE_ETFS = { market: 1, sector: 11, subsector: 44, countedOn: '2026-11-24' } as const;

const PRODUCTS: { what: string; capability: string }[] = [
  { what: 'Latest risk decomposition and hedge ratios for one stock', capability: 'metrics' },
  { what: 'Daily returns with factor and residual series', capability: 'ticker-returns' },
  { what: 'Cross-sectional rank of one stock', capability: 'rankings' },
  { what: 'Decomposition of a single position in dollars', capability: 'decompose-position' },
  { what: 'Exposure of a long or long/short book', capability: 'portfolio-exposure' },
  { what: 'Mutual fund holdings and risk metrics', capability: 'fund-metrics' },
  { what: '13F filer holdings and risk metrics', capability: 'filer-metrics' },
  { what: 'Security identity at a past date', capability: 'identity-resolve' },
];

const METHOD: { title: string; note: string; href: string }[] = [
  {
    title: 'Model design',
    note: 'Factor definitions, the order of the regressions and how hedge ratios are built.',
    href: `https://riskmodels.org/methodology?${ORG_UTM}`,
  },
  {
    title: 'One position, four bets',
    note: 'Worked decompositions of paired large-capitalisation stocks.',
    href: `https://riskmodels.org/research/part-1-hidden-concentration?${ORG_UTM}`,
  },
  {
    title: 'Risk structure in 13F filings',
    note: 'The same decomposition applied to reported institutional books.',
    href: `https://riskmodels.org/research/part-2-risk-structure-13f-filings?${ORG_UTM}`,
  },
];

function usd(n: number | null | undefined): string {
  if (n == null) return 'see pricing';
  if (n === 0) return 'Free';
  return `$${n.toFixed(3).replace(/0$/, '')}`;
}

function ratio(n: number | null): string {
  return n == null ? 'n/a' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`;
}

function share(n: number | null): string {
  return n == null ? 'n/a' : `${(n * 100).toFixed(1).replace('-', '−')}%`;
}

function abridged(m: MetricsExhibit): string {
  return JSON.stringify(
    {
      ticker: m.ticker,
      teo: m.teo,
      hedge_levels: { L3: m.l3 },
      _metadata: m.metadata,
    },
    null,
    2,
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="rm-small border-y border-rule py-4">
      Data unavailable. {what} could not be read when this page was built.
    </p>
  );
}

export default async function HomePage() {
  const [metrics, feed, health] = await Promise.all([getMetricsExhibit(), getFeedSample(), getHealth()]);
  const l3 = metrics.l3;
  const layers = [
    { name: 'Market', etf: l3.hedge_etfs.market, hr: l3.market_hr, er: l3.market_er, color: 'var(--rm-factor-market)' },
    { name: 'Sector', etf: l3.hedge_etfs.sector, hr: l3.sector_hr, er: l3.sector_er, color: 'var(--rm-factor-sector)' },
    {
      name: 'Subsector',
      etf: l3.hedge_etfs.subsector,
      hr: l3.subsector_hr,
      er: l3.subsector_er,
      color: 'var(--rm-factor-subsector)',
    },
    { name: 'Residual', etf: null, hr: null, er: l3.residual_er, color: 'var(--rm-factor-residual)' },
  ];
  const metricsPrice = getCapabilityById('metrics')?.pricing.cost_usd ?? null;
  const coverage = health?.teo_coverage;

  return (
    <div className="rm-page">
      {/* 1 · Masthead */}
      <header className="grid gap-x-10 gap-y-8 pb-2 pt-6 sm:pt-14 lg:grid-cols-12 lg:pt-16">
        <div className="lg:col-span-7">
          <p className="rm-label">Equity risk data · API</p>
          <h1 className="rm-h1 mt-4">
            Daily risk decomposition and ETF hedge ratios for about 3,000 US stocks, by API.
          </h1>
          <p className="rm-lede mt-4 sm:mt-5">
            Each stock is split into market, sector, subsector and residual risk, with the ETF trade that offsets
            each layer. Delivered by REST, a Python SDK, a command line and a hosted connector for AI assistants.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 sm:mt-7 sm:gap-3">
            <TrackedLink href="/get-key" location="hero" className="rm-btn">
              Get an API key
            </TrackedLink>
            <TrackedLink href="#assistant" location="hero" label="Try in Claude or Cursor" className="rm-btn-ghost">
              Try in Claude or Cursor, no key required
            </TrackedLink>
          </div>
          <p className="rm-small mt-4 hidden sm:block">
            A key comes with $20 of credit and needs no card. End-of-day historical data; not investment advice.
          </p>
        </div>

        <figure className="min-w-0 lg:col-span-5">
          <figcaption className="rm-label border-b border-[var(--rm-ink)] pb-2">
            {metrics.ticker} · data date {metrics.teo} · model {metrics.metadata.model_version}
          </figcaption>
          <div className="rm-scroll-x">
            <table className="rm-table">
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">ETF</th>
                  <th scope="col" className="num">
                    Hedge ratio
                  </th>
                  <th scope="col" className="num">
                    <span className="sm:hidden">Variance</span>
                    <span className="hidden sm:inline">Share of variance</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {layers.map((l) => (
                  <tr key={l.name}>
                    <td className="whitespace-nowrap">
                      <span
                        aria-hidden
                        className="mr-2 inline-block size-2 align-baseline"
                        style={{ background: l.color }}
                      />
                      {l.name}
                    </td>
                    <td className="rm-mono">{l.etf ?? '—'}</td>
                    <td className="num">{l.hr == null ? '—' : ratio(l.hr)}</td>
                    <td className="num">{share(l.er)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rm-small mt-3">
            Hedge ratio is dollars of the ETF per dollar of stock: negative is a short, positive a long, because
            each layer is measured after the ones above it. Share of variance is the share that layer&rsquo;s
            hedge removed over the estimation window; the four sum to 100%, and one can fall slightly below zero
            when that hedge added variance. Values are from{' '}
            <code className="rm-mono">GET /api/metrics/NVDA</code>,{' '}
            {metrics.source === 'live'
              ? `read from production on ${metrics.obtained}`
              : `a response recorded on ${metrics.obtained}`}
            . The response states the model version and data date; it does not state the estimation window,
            which is described in the{' '}
            <Link href="/docs/methodology" className="rm-link">
              methodology
            </Link>
            .
          </p>
          <p className="rm-small mt-3 sm:hidden">
            A key comes with $20 of credit and needs no card. End-of-day historical data; not investment advice.
          </p>
        </figure>
      </header>

      {/* 2 · One request, one response */}
      <section className="rm-section" aria-labelledby="request">
        <SectionHead n="01" label="First call" title="One request, one response" id="request">
          <p>
            The request below returns the table above. The response is printed as returned, cut to the three-ETF
            hedge and the model metadata.
          </p>
        </SectionHead>
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
          <CodeExhibit
            caption="Request"
            tabs={[
              { id: 'curl', label: 'curl', code: CURL, note: `Needs an API key. Costs ${usd(metricsPrice)} per request.` },
              { id: 'python', label: 'Python', code: PYTHON, note: 'The SDK returns the same fields under short names.' },
              { id: 'cli', label: 'Command line', code: CLI, note: 'Needs Node.js 18 or later and RISKMODELS_API_KEY.' },
            ]}
          />
          <CodeExhibit
            caption={`Response · abridged · ${metrics.source === 'live' ? 'read' : 'recorded'} ${metrics.obtained}`}
            tabs={[{ id: 'json', label: 'JSON', code: abridged(metrics) }]}
          />
        </div>
      </section>

      {/* 3 · Figures */}
      <section className="rm-section" aria-label="Coverage">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
          <div>
            <dd className="rm-num">{coverage ? coverage.universe_stock_count.toLocaleString('en-US') : '—'}</dd>
            <dt className="rm-small mt-2">
              US stocks in the model universe. <span className="rm-mono">/api/health</span>
            </dt>
          </div>
          <div>
            <dd className="rm-num">{HEDGE_ETFS.market + HEDGE_ETFS.sector + HEDGE_ETFS.subsector}</dd>
            <dt className="rm-small mt-2">
              Hedge ETFs: {HEDGE_ETFS.market} market, {HEDGE_ETFS.sector} sector, {HEDGE_ETFS.subsector} subsector,
              counted {HEDGE_ETFS.countedOn}. <span className="rm-mono break-all">/api/data/etf/universe</span>
            </dt>
          </div>
          <div>
            <dd className="rm-num">{coverage ? coverage.latest_teo : '—'}</dd>
            <dt className="rm-small mt-2">
              Latest trading day in the data. <span className="rm-mono">/api/health</span>
            </dt>
          </div>
          <div>
            <dd className="rm-num">{usd(metricsPrice)}</dd>
            <dt className="rm-small mt-2">
              Per request for one stock&rsquo;s metrics. <span className="rm-mono">/api/pricing</span>
            </dt>
          </div>
        </dl>
      </section>

      {/* 4 · What the API returns */}
      <section className="rm-section" aria-labelledby="returns">
        <SectionHead n="02" label="Products" title="What the API returns" id="returns" />
        <div className="rm-scroll-x mt-8">
          <table className="rm-table min-w-[36rem]">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Endpoint</th>
                <th scope="col" className="num">
                  Price per request
                </th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((p) => {
                const cap = getCapabilityById(p.capability);
                if (!cap) return null;
                return (
                  <tr key={p.capability}>
                    <td>{p.what}</td>
                    <td className="rm-mono text-[0.8125rem]">
                      {cap.method} {cap.endpoint}
                    </td>
                    <td className="num">{usd(cap.pricing.cost_usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="rm-small mt-4">
          Prices are read from the same price list the API bills from. Every endpoint, with parameters and
          response fields, is in the{' '}
          <Link href="/api-reference" className="rm-link">
            API reference
          </Link>
          ; the machine-readable file is{' '}
          <Link href="/openapi.json" prefetch={false} className="rm-link">
            openapi.json
          </Link>
          .
        </p>
      </section>

      {/* 5 · Connect an assistant */}
      <section className="rm-section" aria-labelledby="assistant">
        <SectionHead n="03" label="Assistants" title="Connect an AI assistant" id="assistant">
          <p>
            The hosted connector gives an assistant the same data as tools. Sign-in is in the browser; calls are
            billed to the signed-in account at the prices above.
          </p>
        </SectionHead>
        <div className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <ConnectorSteps />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <table className="rm-table">
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">Address or command</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Claude</td>
                  <td className="rm-mono break-all text-[0.8125rem]">riskmodels.app/api/mcp/sse</td>
                </tr>
                <tr>
                  <td>ChatGPT</td>
                  <td className="rm-mono break-all text-[0.8125rem]">riskmodels.app/api/mcp/openai</td>
                </tr>
                <tr>
                  <td>Other clients</td>
                  <td className="rm-mono break-all text-[0.8125rem]">riskmodels.app/api/mcp</td>
                </tr>
                <tr>
                  <td>Local, with a key</td>
                  <td className="rm-mono break-all text-[0.8125rem]">npx -y riskmodels@latest install</td>
                </tr>
              </tbody>
            </table>
            <p className="rm-small mt-4">
              <Link href="/docs/agent-integration" className="rm-link">
                Connector setup
              </Link>{' '}
              ·{' '}
              <Link href="/for-agents" className="rm-link">
                For agents
              </Link>{' '}
              ·{' '}
              <Link href="/llms.txt" prefetch={false} className="rm-link">
                llms.txt
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* 6 · Event feed */}
      <section className="rm-section" aria-labelledby="feed">
        <SectionHead n="04" label="Event feed" title="Identity and listing events, each cited to a filing" id="feed">
          <p>
            A separate daily record of ticker and name changes, delistings, mergers and splits for US equities.
            The rows below are the current public sample; approved subscribers receive current events by email
            and private RSS.
          </p>
        </SectionHead>
        <div className="mt-8">
          {feed ? (
            <>
              <FeedTable events={feed.events.slice(0, 5)} />
              <p className="rm-small mt-4">
                Public sample through {feed.sample_through ?? feed.latest_known_date}, from{' '}
                <Link href="/security-master-feed/latest.json" prefetch={false} className="rm-link rm-mono">
                  /security-master-feed/latest.json
                </Link>
                .
              </p>
            </>
          ) : (
            <Unavailable what="The feed sample" />
          )}
          <p className="mt-6">
            <TrackedLink href="/security-master-feed" location="home-feed" className="rm-btn-ghost">
              Request feed access
            </TrackedLink>
          </p>
        </div>
      </section>

      {/* 7 · Method and evidence */}
      <section className="rm-section" aria-labelledby="method">
        <SectionHead n="05" label="Method" title="Method and evidence" id="method">
          <p>
            The four shares of variance sum to one by construction. That is an accounting identity and says
            nothing about accuracy. What has been tested, and how, is in the published papers.
          </p>
        </SectionHead>
        <ul className="mt-8 divide-y divide-[var(--rm-rule)] border-y border-rule">
          {METHOD.map((m) => (
            <li key={m.href} className="grid gap-x-8 gap-y-1 py-4 lg:grid-cols-12">
              <a href={m.href} target="_blank" rel="noopener noreferrer" className="rm-h3 rm-link lg:col-span-5">
                {m.title}
              </a>
              <p className="text-[0.9375rem] text-ink-muted lg:col-span-7">{m.note} On riskmodels.org.</p>
            </li>
          ))}
          <li className="grid gap-x-8 gap-y-1 py-4 lg:grid-cols-12">
            <Link href="/docs/methodology" className="rm-h3 rm-link lg:col-span-5">
              Field definitions
            </Link>
            <p className="text-[0.9375rem] text-ink-muted lg:col-span-7">
              What each returned field means and how it is computed.
            </p>
          </li>
        </ul>
      </section>

      {/* 8 · Pricing and licence */}
      <section className="rm-section" aria-labelledby="pricing">
        <SectionHead n="06" label="Pricing" title="Pay per request; licences for firms" id="pricing">
          <p>
            A new account receives $20 of credit at sign-in, with no card. After that, requests draw on prepaid
            credit at the listed prices. Firms that need redistribution or internal-use terms take an annual
            licence.
          </p>
        </SectionHead>
        <p className="mt-6 lg:ml-[25%] lg:pl-2">
          <TrackedLink href="/pricing" location="home-pricing" className="rm-btn-ghost">
            See prices and licences
          </TrackedLink>
        </p>
      </section>

      {/* 9 · Operations */}
      <section className="rm-section" aria-labelledby="operations">
        <SectionHead n="07" label="Operations" title="Status and records" id="operations" />
        <div className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            {health ? (
              <table className="rm-table">
                <tbody>
                  <tr>
                    <td>API status</td>
                    <td className="num">{health.status}</td>
                  </tr>
                  <tr>
                    <td>Database latency</td>
                    <td className="num">
                      {health.services.database?.latency_ms != null ? `${health.services.database.latency_ms} ms` : '—'}
                    </td>
                  </tr>
                  {coverage ? (
                    <tr>
                      <td>Stocks with a return on {coverage.latest_teo}</td>
                      <td className="num">
                        {coverage.non_null_returns_symbol_count.toLocaleString('en-US')} of{' '}
                        {coverage.universe_stock_count.toLocaleString('en-US')}
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <td>Checked</td>
                    <td className="num">{health.timestamp.slice(0, 16).replace('T', ' ')} UTC</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <Unavailable what="The health endpoint" />
            )}
            <p className="rm-small mt-4">
              From <span className="rm-mono">GET /api/health</span>. Per-endpoint latency and success rates are on
              the{' '}
              <Link href="/status" className="rm-link">
                status page
              </Link>
              .
            </p>
          </div>
          <ul className="space-y-2 text-[0.9375rem] lg:col-span-5">
            <li>
              <Link href="/docs/changelog" className="rm-link">
                Changelog
              </Link>
            </li>
            <li>
              <Link href="/openapi.json" prefetch={false} className="rm-link">
                OpenAPI file
              </Link>
            </li>
            <li>
              <Link href="/legal" className="rm-link">
                Terms and disclosures
              </Link>
            </li>
            <li>
              <a href="mailto:service@riskmodels.app" className="rm-link">
                service@riskmodels.app
              </a>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
