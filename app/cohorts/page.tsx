/**
 * /cohorts — Dispersion & Opportunity
 *
 * Nothing else in the product shows where cross-sectional selection opportunity
 * sits. A cohort with wide residual dispersion has something to select from; a
 * tight one does not, regardless of model skill. That is an allocation question
 * — where to spend risk budget — not a signal, and the page is written to say
 * so plainly.
 *
 * Two honesty requirements drive the layout:
 *
 *   1. Dispersion conflates idiosyncratic volatility with cross-correlation, so
 *      `residual_sd` never appears without `mean_pairwise_corr` beside it, and
 *      `n_effective` sits next to `n_names` because a cohort with one dominant
 *      constituent has far less breadth than its headcount implies.
 *   2. A cohort's factor is often computed from a *different* instrument than
 *      its own — XLC runs on VOX for most of the 2000s, XLRE on VNQ then XLF.
 *      Any long-history series shades those spans, otherwise the reader takes a
 *      partly-different basket for a continuous one.
 *
 * Realized history only. No forecasts, ratings, or recommendations.
 *
 * Server component — reads the cohort service directly, so no API key round-trip.
 */

import { getCohortService } from "@/lib/risk/cohort-service";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Cohort Dispersion — RiskModels",
  description:
    "Where cross-sectional selection opportunity sits across the market and GICS sector cohorts: residual dispersion, mean pairwise correlation, and effective breadth.",
};

const NAVY = "#002a5e";
const TEAL = "#006f8e";
const SLATE = "#2a7fbf";
const ORANGE = "#E07000";

/** Below this member count a cohort's cross-sectional statistics are noise. */
const THIN_NAMES = 20;

/**
 * Trailing windows for the history panel. The default is decision-relevant;
 * the longer options reach back far enough to cross the spans where a cohort's
 * factor ran on a substitute instrument, which is where the shading matters.
 */
const WINDOWS = {
  "3y": { days: 3 * 365, label: "3 years" },
  "10y": { days: 10 * 365, label: "10 years" },
  max: { days: 27 * 365, label: "Full panel" },
} as const;

type WindowKey = keyof typeof WINDOWS;

function resolveWindow(raw: string | undefined): WindowKey {
  return raw && raw in WINDOWS ? (raw as WindowKey) : "3y";
}

const SERIES_COHORTS = ["XLK", "XLE", "XLF", "XLV", "XLC"] as const;
const SERIES_COLORS: Record<string, string> = {
  XLK: NAVY,
  XLE: ORANGE,
  XLF: TEAL,
  XLV: SLATE,
  XLC: "#8e6f00",
};

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface Row {
  ticker: string;
  level: number;
  sd: number | null;
  corr: number | null;
  nNames: number | null;
  nEff: number | null;
  mean: number | null;
}

/** Contiguous [startIdx, endIdx] runs where the factor came from a substitute. */
function proxySpans(flags: boolean[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start < 0) start = i;
    if ((!flags[i] || i === flags.length - 1) && start >= 0) {
      spans.push([start, flags[i] ? i : i - 1]);
      start = -1;
    }
  }
  return spans;
}

export default async function CohortDispersionPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window: windowParam } = await searchParams;
  const windowKey = resolveWindow(windowParam);
  const service = getCohortService();

  const [snapshot, history] = await Promise.all([
    service.getCrossSection({
      variables: [
        "residual_sd",
        "mean_pairwise_corr",
        "n_names",
        "n_effective",
        "residual_mean",
      ],
    }),
    service.getSeries({
      tickers: [...SERIES_COHORTS],
      variables: ["residual_sd", "residual_mean", "factor_source"],
      startDate: isoDaysAgo(WINDOWS[windowKey].days),
    }),
  ]);

  if (!snapshot) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">Cohort data is unavailable right now.</p>
      </main>
    );
  }

  const rows: Row[] = snapshot.cohorts
    .map((c) => ({
      ticker: c.ticker,
      level: c.level,
      sd: c.values.residual_sd ?? null,
      corr: c.values.mean_pairwise_corr ?? null,
      nNames: c.values.n_names ?? null,
      nEff: c.values.n_effective ?? null,
      mean: c.values.residual_mean ?? null,
    }))
    .sort((a, b) => (b.sd ?? -1) - (a.sd ?? -1));

  const sectors = rows.filter((r) => r.level === 2);
  const market = rows.find((r) => r.level === 1) ?? null;
  const maxSd = Math.max(...rows.map((r) => r.sd ?? 0), 1e-9);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="text-white px-8 py-7" style={{ backgroundColor: NAVY }}>
        <div className="max-w-6xl mx-auto">
          <p className="text-sm text-slate-300 mb-1">Cohort Analytics</p>
          <h1 className="text-3xl font-bold tracking-tight">Dispersion &amp; Opportunity</h1>
          <p className="text-sm text-slate-300 mt-2 max-w-3xl">
            How much cross-sectional spread there is inside each cohort — a measure of how
            much there is to select from, not a view on what to select. As of{" "}
            <span className="font-medium text-white">{snapshot.teo}</span> · universe{" "}
            {snapshot.universe} · market factor {snapshot.market_factor_etf}.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-10">
        {/* ── The contract that governs every number below ─────────────── */}
        <section
          className="rounded-lg border-l-4 bg-white p-5 shadow-sm"
          style={{ borderLeftColor: ORANGE }}
        >
          <h2 className="text-base font-semibold text-slate-900">
            Residuals are not zero-mean
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            {snapshot.disclosures.no_intercept_contract ??
              "ERM3 residuals are estimated without an intercept and therefore retain each stock's alpha. The cross-sectional mean is not zero."}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The mean drifts, and its sign is not stable across the sample — a drift figure
            quoted without its window is meaningless. The current cohort means are in the
            table below; fetch the series from{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
              /api/cohorts/series
            </code>{" "}
            to demean over your own window.
          </p>
        </section>

        {/* ── Dispersion cross-section ─────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-slate-900">
              Where the opportunity is today
            </h2>
            <span className="text-xs text-slate-500">
              sorted by residual dispersion
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            {snapshot.disclosures.dispersion_use}
          </p>

          <div className="mt-5 overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Cohort</th>
                  <th className="px-4 py-3 font-medium w-[38%]">Residual dispersion</th>
                  <th className="px-4 py-3 font-medium text-right">Mean pairwise corr</th>
                  <th className="px-4 py-3 font-medium text-right">Effective breadth</th>
                  <th className="px-4 py-3 font-medium text-right">Members</th>
                  <th className="px-4 py-3 font-medium text-right">Residual mean</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const thin = r.nNames != null && r.nNames < THIN_NAMES;
                  const width = r.sd != null ? Math.max((r.sd / maxSd) * 100, 1.5) : 0;
                  return (
                    <tr
                      key={r.ticker}
                      className={`border-b border-slate-100 last:border-0 ${
                        thin ? "opacity-45" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900">{r.ticker}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {r.level === 1 ? "market" : "sector"}
                        </span>
                        {thin && (
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                            style={{ backgroundColor: "#fdecd8", color: ORANGE }}
                            title={`Fewer than ${THIN_NAMES} members — these statistics are noise.`}
                          >
                            thin
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                            <div
                              className="h-2.5 rounded-full"
                              style={{
                                width: `${width}%`,
                                backgroundColor: r.level === 1 ? NAVY : TEAL,
                              }}
                            />
                          </div>
                          <span className="w-16 text-right tabular-nums text-slate-700">
                            {fmtPct(r.sd)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {fmtNum(r.corr, 2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {fmtNum(r.nEff, 1)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {r.nNames ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {fmtPct(r.mean)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-500 max-w-3xl">
            {snapshot.disclosures.thin_cohorts} Effective breadth is inverse-Herfindahl:
            {market && market.nEff != null && market.nNames != null ? (
              <>
                {" "}
                the market cohort carries {market.nNames} names but only{" "}
                {fmtNum(market.nEff, 0)} of effective breadth.
              </>
            ) : null}
          </p>
        </section>

        {/* ── Dispersion history ───────────────────────────────────────── */}
        {history && history.cohorts.length > 0 && (
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900">
                Dispersion over {WINDOWS[windowKey].label.toLowerCase()}
              </h2>
              <div className="flex gap-1.5">
                {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
                  <a
                    key={k}
                    href={`/cohorts?window=${k}`}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      k === windowKey
                        ? "text-white"
                        : "bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                    style={k === windowKey ? { backgroundColor: NAVY } : undefined}
                  >
                    {WINDOWS[k].label}
                  </a>
                ))}
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600 max-w-3xl">
              Shaded spans mark days when the cohort factor was computed from a substitute
              instrument rather than its own. Over long windows this is not a footnote —
              some cohorts are majority-proxied, and the series there describes a partly
              different basket.
            </p>
            <div className="mt-5 rounded-lg bg-white p-5 shadow-sm">
              <DispersionChart history={history} />
            </div>
          </section>
        )}

        {/* ── The drift side of selection-vs-drift ─────────────────────── */}
        {history && history.cohorts.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              What net exposure alone would have earned
            </h2>
            <p className="mt-1 text-sm text-slate-600 max-w-3xl">
              Because residuals are not zero-mean, simply being net long a cohort earns
              its average residual — whether or not anything was selected well. The lines
              below accumulate each cohort&apos;s mean residual over the window: the
              realized return of a unit of net exposure, before any stock-picking. It is
              the &ldquo;drift&rdquo; half of the question <em>am I paid for picking
              stocks, or for being net long the average stock?</em>
            </p>
            <div className="mt-5 rounded-lg bg-white p-5 shadow-sm">
              <DriftChart history={history} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500 max-w-3xl">
              To split your own book&apos;s realized residual return into selection and
              drift, post its positions to{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5">
                /api/cohorts/pnl-decomposition
              </code>
              . The two components sum to the total exactly — it is an identity, not a
              fitted attribution.
            </p>
          </section>
        )}

        {/* ── Coverage and caveats, stated not buried ──────────────────── */}
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Coverage and caveats</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
            <li>{snapshot.disclosures.coverage}</li>
            <li>
              Mean pairwise correlation is an identity-based estimator derived from the
              portfolio-variance relation, not a full pairwise correlation matrix. It is
              the right quantity but it is an estimate — read it to one or two decimals,
              no further.
            </li>
            <li>{snapshot.disclosures.er_sign}</li>
            {snapshot.disclosures.return_source_legend && (
              <li className="text-xs text-slate-500">
                {snapshot.disclosures.return_source_legend}
              </li>
            )}
          </ul>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Realized historical statistics only. Nothing here is a forecast, a rating, or a
            recommendation to buy or sell any security. Public cohort scope is the market
            factor plus the 11 GICS sector SPDRs.
            {snapshot.store_build && <> Data build {snapshot.store_build}.</>}
          </p>
        </section>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

type HistoryResult = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getCohortService>["getSeries"]>>
>;

/**
 * Multi-line dispersion chart, inline SVG to match the rest of the app (no
 * client-side chart runtime on this page).
 *
 * The x-axis is the union of dates across cohorts so the lines stay comparable;
 * proxied spans are shaded per cohort behind its line.
 */
function DispersionChart({ history }: { history: HistoryResult }) {
  const W = 900;
  const H = 300;
  const PAD = { top: 12, right: 16, bottom: 28, left: 48 };

  const dates = Array.from(
    new Set(history.cohorts.flatMap((c) => c.points.map((p) => p.date))),
  ).sort();
  if (dates.length < 2) return null;
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  let maxY = 0;
  for (const c of history.cohorts) {
    for (const p of c.points) {
      const v = p.values.residual_sd;
      if (v != null && Number.isFinite(v) && v > maxY) maxY = v;
    }
  }
  if (maxY <= 0) return null;
  maxY *= 1.08;

  const x = (i: number) => PAD.left + (i / (dates.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / maxY) * plotH;

  const yTicks = Array.from({ length: 5 }, (_, i) => (maxY / 4) * i);
  const xTickIdx = [0, Math.floor(dates.length / 3), Math.floor((2 * dates.length) / 3), dates.length - 1];

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Residual dispersion by cohort over the last three years"
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
              {(t * 100).toFixed(1)}%
            </text>
          </g>
        ))}

        {xTickIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill="#64748b"
          >
            {dates[i]?.slice(0, 7)}
          </text>
        ))}

        {history.cohorts.map((c) => {
          const color = SERIES_COLORS[c.ticker] ?? SLATE;
          const flags = dates.map((d) => {
            const p = c.points.find((pt) => pt.date === d);
            const fs = p?.values.factor_source;
            return fs != null && fs !== 0;
          });
          return proxySpans(flags).map(([s, e], k) => (
            <rect
              key={`${c.ticker}-proxy-${k}`}
              x={x(s)}
              width={Math.max(x(e) - x(s), 1)}
              y={PAD.top}
              height={plotH}
              fill={color}
              opacity={0.07}
            />
          ));
        })}

        {history.cohorts.map((c) => {
          const color = SERIES_COLORS[c.ticker] ?? SLATE;
          let d = "";
          let pen = false;
          for (const p of c.points) {
            const v = p.values.residual_sd;
            const i = dateIdx.get(p.date);
            if (v == null || !Number.isFinite(v) || i === undefined) {
              pen = false;
              continue;
            }
            d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
            pen = true;
          }
          return (
            <path
              key={c.ticker}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
          );
        })}
      </svg>

      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
        {history.cohorts.map((c) => (
          <span key={c.ticker} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ backgroundColor: SERIES_COLORS[c.ticker] ?? SLATE }}
            />
            {c.ticker}
            {c.proxied_fraction > 0.01 && (
              <span className="text-slate-400">
                ({(c.proxied_fraction * 100).toFixed(0)}% proxied)
              </span>
            )}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Cumulative sum of each cohort's mean residual — the realized return of a unit
 * of net exposure, before any selection.
 *
 * Summed rather than compounded: the decomposition these feed is additive in
 * daily residuals, so a cumulative sum is the quantity that reconciles with it.
 * Zero line is drawn because the sign is the whole point — it flips across the
 * sample, and a chart that hid the axis would invite reading a level off it.
 */
function DriftChart({ history }: { history: HistoryResult }) {
  const W = 900;
  const H = 260;
  const PAD = { top: 12, right: 16, bottom: 28, left: 52 };

  const dates = Array.from(
    new Set(history.cohorts.flatMap((c) => c.points.map((p) => p.date))),
  ).sort();
  if (dates.length < 2) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const cum = new Map<string, Array<{ i: number; v: number }>>();
  let lo = 0;
  let hi = 0;
  history.cohorts.forEach((c) => {
    const byDate = new Map(c.points.map((p) => [p.date, p.values.residual_mean]));
    const pts: Array<{ i: number; v: number }> = [];
    let acc = 0;
    dates.forEach((d, i) => {
      const v = byDate.get(d);
      if (v == null || !Number.isFinite(v)) return;
      acc += v;
      pts.push({ i, v: acc });
      if (acc < lo) lo = acc;
      if (acc > hi) hi = acc;
    });
    cum.set(c.ticker, pts);
  });

  if (hi === lo) return null;
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;

  const x = (i: number) => PAD.left + (i / (dates.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) / 4) * i);
  const xTickIdx = [0, Math.floor(dates.length / 2), dates.length - 1];

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Cumulative mean residual by cohort — the return of net exposure alone"
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {lo < 0 && hi > 0 && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(0)}
            y2={y(0)}
            stroke="#94a3b8"
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
        )}

        {xTickIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill="#64748b"
          >
            {dates[i]?.slice(0, 7)}
          </text>
        ))}

        {history.cohorts.map((c) => {
          const pts = cum.get(c.ticker) ?? [];
          if (pts.length < 2) return null;
          const d = pts
            .map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
            .join("");
          return (
            <path
              key={c.ticker}
              d={d}
              fill="none"
              stroke={SERIES_COLORS[c.ticker] ?? SLATE}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          );
        })}
      </svg>

      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
        {history.cohorts.map((c) => {
          const pts = cum.get(c.ticker) ?? [];
          const end = pts.length ? pts[pts.length - 1]!.v : null;
          return (
            <span key={c.ticker} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ backgroundColor: SERIES_COLORS[c.ticker] ?? SLATE }}
              />
              {c.ticker}
              {end != null && (
                <span className={end < 0 ? "text-slate-500" : "text-slate-500"}>
                  ({end >= 0 ? "+" : ""}
                  {(end * 100).toFixed(1)}%)
                </span>
              )}
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
