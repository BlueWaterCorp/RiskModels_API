import type { Metadata } from 'next';
import Link from 'next/link';
import { getHealth } from '@/lib/site/live';

export const metadata: Metadata = {
  title: 'Status',
  description:
    'Current state of the RiskModels API: service health, the latest trading day in the data, and 24-hour latency and success rate for each endpoint group.',
  alternates: { canonical: '/status' },
};

export const revalidate = 60;

function word(status: string): { text: string; color: string } {
  const ok = status === 'healthy' || status === 'available';
  const bad = status === 'unhealthy' || status === 'unavailable' || status === 'down';
  return { text: status, color: ok ? 'var(--rm-ok)' : bad ? 'var(--rm-bad)' : 'var(--rm-warn)' };
}

function Status({ status }: { status: string }) {
  const w = word(status);
  return (
    <span className="rm-mono" style={{ color: w.color }}>
      {w.text}
    </span>
  );
}

export default async function StatusPage() {
  const health = await getHealth();
  const coverage = health?.teo_coverage;
  const capabilities = health ? Object.entries(health.capabilities).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="rm-page">
      <header className="pt-10 sm:pt-14">
        <p className="rm-label">Operations</p>
        <h1 className="rm-h1 mt-4">Status</h1>
        <p className="rm-lede mt-5">
          This page prints what <span className="rm-mono text-[0.9em]">GET /api/health</span> returns. It is re-read
          at most once a minute.
        </p>
      </header>

      {!health ? (
        <section className="rm-section">
          <p className="rm-body">
            Data unavailable. The request to the health endpoint failed when this page was built. Query it directly at{' '}
            <Link href="/api/health" prefetch={false} className="rm-link rm-mono">
              /api/health
            </Link>{' '}
            or write to{' '}
            <a href="mailto:service@riskmodels.app" className="rm-link">
              service@riskmodels.app
            </a>
            .
          </p>
        </section>
      ) : (
        <>
          <section className="rm-section" aria-labelledby="services">
            <h2 id="services" className="rm-h2">
              Service
            </h2>
            <div className="rm-scroll-x mt-6">
              <table className="rm-table">
                <tbody>
                  <tr>
                    <td>Overall</td>
                    <td className="num">
                      <Status status={health.status} />
                    </td>
                  </tr>
                  {Object.entries(health.services).map(([name, s]) => (
                    <tr key={name}>
                      <td className="capitalize">{name === 'api' ? 'API' : name}</td>
                      <td className="num">
                        <Status status={s.status} />
                        {name !== 'api' && s.latency_ms != null ? ` · ${s.latency_ms} ms` : ''}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>API version</td>
                    <td className="num">{health.version}</td>
                  </tr>
                  <tr>
                    <td>Checked</td>
                    <td className="num">{health.timestamp.slice(0, 19).replace('T', ' ')} UTC</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {coverage ? (
            <section className="rm-section" aria-labelledby="data">
              <h2 id="data" className="rm-h2">
                Data
              </h2>
              <div className="rm-scroll-x mt-6">
                <table className="rm-table">
                  <tbody>
                    <tr>
                      <td>Latest trading day in the data</td>
                      <td className="num">{coverage.latest_teo}</td>
                    </tr>
                    <tr>
                      <td>Stocks in the model universe</td>
                      <td className="num">{coverage.universe_stock_count.toLocaleString('en-US')}</td>
                    </tr>
                    <tr>
                      <td>Stocks with a return on that day</td>
                      <td className="num">
                        {coverage.non_null_returns_symbol_count.toLocaleString('en-US')} (
                        {coverage.latest_teo_coverage_pct.toFixed(1)}%)
                      </td>
                    </tr>
                    <tr>
                      <td>Latest session still loading</td>
                      <td className="num">{coverage.latest_session_returns_pending ? 'yes' : 'no'}</td>
                    </tr>
                    {health.macro_factors ? (
                      <tr>
                        <td>Macro factor series</td>
                        <td className="num">
                          <Status status={health.macro_factors.status} />
                          {health.macro_factors.newest_teo ? ` · through ${health.macro_factors.newest_teo}` : ''}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="rm-small mt-4">
                Data is end-of-day. A stock in the universe can lack a return on a given day, for example on a day
                with no trades.
              </p>
            </section>
          ) : null}

          <section className="rm-section" aria-labelledby="endpoints">
            <h2 id="endpoints" className="rm-h2">
              Endpoint groups, last 24 hours
            </h2>
            <div className="rm-scroll-x mt-6">
              <table className="rm-table min-w-[30rem]">
                <thead>
                  <tr>
                    <th scope="col">Group</th>
                    <th scope="col">State</th>
                    <th scope="col" className="num">
                      Mean latency
                    </th>
                    <th scope="col" className="num">
                      Success rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {capabilities.map(([id, c]) => (
                    <tr key={id}>
                      <td className="rm-mono text-[0.8125rem]">{id}</td>
                      <td>
                        <Status status={c.status} />
                      </td>
                      <td className="num">
                        {c.avg_latency_ms_24h != null ? `${Math.round(c.avg_latency_ms_24h).toLocaleString('en-US')} ms` : '—'}
                      </td>
                      <td className="num">
                        {c.success_rate_24h != null ? `${(c.success_rate_24h * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rm-small mt-4">
              Only groups that received requests in the window are listed. Latency is measured at the server and
              includes model computation; portfolio endpoints are the slowest because they process every position.
            </p>
          </section>
        </>
      )}

      <section className="rm-section" aria-labelledby="records">
        <h2 id="records" className="rm-h2">
          Records
        </h2>
        <ul className="mt-6 divide-y divide-[var(--rm-rule)] border-y border-rule text-[0.9375rem]">
          <li className="py-3">
            <Link href="/docs/changelog" className="rm-link">
              Changelog
            </Link>
            <span className="text-ink-muted"> — changes to endpoints and fields, by date.</span>
          </li>
          <li className="py-3">
            <Link href="/api/health" prefetch={false} className="rm-link rm-mono">
              /api/health
            </Link>
            <span className="text-ink-muted"> — the source of this page, as JSON.</span>
          </li>
          <li className="py-3">
            <a href="mailto:service@riskmodels.app" className="rm-link">
              service@riskmodels.app
            </a>
            <span className="text-ink-muted"> — to report a problem.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
