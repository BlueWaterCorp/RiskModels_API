/**
 * /ticker/[symbol] — Dynamic Ticker Dashboard
 *
 * Entry point from PDF snapshot QR codes and footer links.
 * Fetches live metrics from the internal API and renders a
 * deep-dive page with OG snapshot card. Supports ?ref= for tracking.
 *
 * @example https://riskmodels.app/ticker/nvda
 * @example https://riskmodels.app/ticker/nvda?ref=snapshot_2026-04-06
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

const GCS_BASE = "https://storage.googleapis.com/rm_api_public/snapshot";
const MAG7 = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META", "TSLA"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TickerMetrics {
  ticker: string;
  company_name: string;
  teo: string;
  sector_etf: string | null;
  subsector_etf: string | null;
  vol_23d: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
  l3_mkt_er: number | null;
  l3_sec_er: number | null;
  l3_sub_er: number | null;
  l3_res_er: number | null;
  /** Daily gross return (decimal), when present on latest row */
  returns_gross: number | null;
  /** Incremental factor returns + L3 residual return for stacked attribution */
  l1_fr: number | null;
  l2_fr: number | null;
  l3_fr: number | null;
  l3_rr: number | null;
}

// ---------------------------------------------------------------------------
// Data fetching (server-side, direct DAL — no auth needed)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const METRIC_KEYS: V3MetricKey[] = [
  "returns_gross",
  "vol_23d",
  "l3_mkt_hr", "l3_sec_hr", "l3_sub_hr",
  "l3_mkt_er", "l3_sec_er", "l3_sub_er", "l3_res_er",
  "l1_fr", "l2_fr", "l3_fr", "l3_rr",
];

async function getTickerMetrics(ticker: string): Promise<TickerMetrics | null> {
  try {
    const symbolRecord = await resolveSymbolByTicker(ticker);
    if (!symbolRecord) return null;

    const latest = await fetchLatestMetricsWithFallback(
      symbolRecord.symbol,
      METRIC_KEYS,
      "daily",
    );
    if (!latest) return null;

    // Resolve company name — symbols.name, then ticker_metadata.company_name
    let companyName = symbolRecord.name;
    if (!companyName) {
      try {
        const supabase = createAdminClient();
        const { data: meta } = await supabase
          .from("ticker_metadata")
          .select("company_name")
          .eq("ticker", symbolRecord.ticker)
          .maybeSingle();
        companyName = meta?.company_name ?? null;
      } catch { /* ticker_metadata may not exist */ }
    }

    const m = latest.metrics;
    return {
      ticker: symbolRecord.ticker,
      company_name: companyName || symbolRecord.ticker,
      teo: latest.teo,
      sector_etf: symbolRecord.sector_etf,
      subsector_etf: symbolRecord.subsector_etf || symbolRecord.sector_etf,
      vol_23d: m.vol_23d ?? null,
      l3_mkt_hr: m.l3_mkt_hr ?? null,
      l3_sec_hr: m.l3_sec_hr ?? null,
      l3_sub_hr: m.l3_sub_hr ?? null,
      l3_mkt_er: m.l3_mkt_er ?? null,
      l3_sec_er: m.l3_sec_er ?? null,
      l3_sub_er: m.l3_sub_er ?? null,
      l3_res_er: m.l3_res_er ?? null,
      returns_gross: m.returns_gross ?? null,
      l1_fr: m.l1_fr ?? null,
      l2_fr: m.l2_fr ?? null,
      l3_fr: m.l3_fr ?? null,
      l3_rr: m.l3_rr ?? null,
    };
  } catch (err) {
    console.error(`[ticker page] Failed to fetch ${ticker}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metadata (SEO)
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();
  const snapshotPng = `${GCS_BASE}/${upper}/${upper}_DD_latest.png`;
  return {
    title: `${upper} — Stock Deep Dive | RiskModels`,
    description: `How to hedge ${upper} with ETFs: dollars of SPY, sector and subsector ETF per $1 of stock, and the stock-specific share of risk that remains.`,
    openGraph: {
      title: `${upper} Deep Dive`,
      description: `Institutional risk analytics for ${upper} — powered by ERM3 V3.`,
      images: [{ url: snapshotPng, width: 2200, height: 1700, alt: `${upper} Deep Dive Snapshot` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Deep Dive`,
      description: `Institutional risk analytics for ${upper}`,
      images: [snapshotPng],
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hedge ratio = ETF dollar position per $1 long stock; negative = short. */
function hedgeSide(hr: number): "short" | "long" {
  return hr < 0 ? "short" : "long";
}

function fmtPct(v: unknown, decimals = 1): string {
  if (v == null) return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : `${(n * 100).toFixed(decimals)}%`;
}

/** Daily simple return as ±bps for small moves */
function fmtSignedBps(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  const bps = v * 10000;
  const sign = bps > 0 ? "+" : "";
  return `${sign}${bps.toFixed(1)} bps`;
}

function hasReturnDecomposition(m: TickerMetrics): boolean {
  return [m.l1_fr, m.l2_fr, m.l3_fr, m.l3_rr].some(
    (x) => x != null && !Number.isNaN(Number(x)),
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function TickerDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { symbol } = await params;
  const { ref } = await searchParams;
  const upper = symbol.toUpperCase();

  const metrics = await getTickerMetrics(upper);
  if (!metrics) return notFound();

  const companyName = metrics.company_name || upper;
  const teo = metrics.teo || "—";
  const subEtf = metrics.subsector_etf || metrics.sector_etf || "—";

  const resER = metrics.l3_res_er;
  const vol = metrics.vol_23d;
  const showReturnDecomp = hasReturnDecomposition(metrics);
  const frParts = [
    { key: "L1 FR", v: metrics.l1_fr, bg: "bg-sky-500" },
    { key: "L2 FR", v: metrics.l2_fr, bg: "bg-indigo-500" },
    { key: "L3 FR", v: metrics.l3_fr, bg: "bg-violet-500" },
    { key: "L3 RR", v: metrics.l3_rr, bg: "bg-slate-500" },
  ] as const;
  const sumAbsFr = frParts.reduce((acc, p) => acc + Math.abs(Number(p.v) || 0), 0) || 1e-12;

  // Share of risk explained by the three ETF layers: the sum of their explained-risk
  // shares; 1 - residual only when those are missing.
  const layerErs = [metrics.l3_mkt_er, metrics.l3_sec_er, metrics.l3_sub_er];
  const explainedShare = layerErs.every((x) => x != null && Number.isFinite(Number(x)))
    ? layerErs.reduce<number>((a, x) => a + Number(x), 0)
    : resER != null
      ? 1 - Number(resER)
      : null;

  const hedgeRows = [
    { layer: "Market", etf: "SPY", hr: metrics.l3_mkt_hr },
    { layer: "Sector", etf: metrics.sector_etf, hr: metrics.l3_sec_hr },
    { layer: "Subsector", etf: metrics.subsector_etf, hr: metrics.l3_sub_hr },
  ].filter((r): r is { layer: string; etf: string; hr: number } =>
    !!r.etf && r.hr != null && Number.isFinite(Number(r.hr)));

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="bg-[#002a5e] text-white px-8 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-300 mb-1">Stock Deep Dive</p>
              <h1 className="text-3xl font-bold tracking-tight">
                {upper} — {companyName}
              </h1>
              <p className="text-sm text-slate-300 mt-1">
                Benchmark: {subEtf} · As of: {teo}
                {ref && (
                  <span className="ml-3 text-xs bg-slate-700 px-2 py-0.5 rounded">
                    via {ref}
                  </span>
                )}
              </p>
            </div>
          </div>
          {/* MAG7 nav */}
          <div className="mt-4 flex flex-wrap gap-2">
            {MAG7.map((t) => (
              <Link
                key={t}
                href={`/ticker/${t}`}
                className={`px-3 py-1 text-sm font-medium rounded-lg transition ${
                  t === upper
                    ? "bg-white text-[#002a5e]"
                    : "bg-white/10 border border-white/20 text-white hover:bg-white/20"
                }`}
              >
                {t}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* ── Metric Cards ────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <MetricCard label="Vol (23d)" value={fmtPct(vol)} />
          <MetricCard label="Stock-specific share of risk" value={fmtPct(resER)} accent />
          <MetricCard label="Explained by market, sector, subsector" value={fmtPct(explainedShare)} />
          <MetricCard label="Subsector ETF" value={subEtf} />
        </div>
      </section>

      {/* ── ETF hedge per $1 long ───────────────────────────────── */}
      {hedgeRows.length > 0 && (
        <section className="max-w-6xl mx-auto px-8 pb-8">
          <h2 className="text-lg font-semibold text-slate-700 mb-1">
            Hedge {upper} with ETFs — per $1 long, as of {teo}
          </h2>
          <p className="text-sm text-slate-500 mb-4 max-w-3xl">
            ERM3 L3 hedge: the dollar position in each ETF per $1 of {upper}. What remains after all
            three legs is the stock-specific risk shown above, which no ETF hedges.
          </p>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100 max-w-2xl">
            {hedgeRows.map((r) => (
              <div key={r.layer} className="flex items-baseline justify-between px-4 py-3">
                <span className="text-sm text-slate-500">{r.layer}</span>
                <span className="font-mono text-lg font-semibold text-slate-800 tabular-nums">
                  <span className="text-slate-500 font-normal">{hedgeSide(Number(r.hr))}</span>{" "}
                  ${Math.abs(Number(r.hr)).toFixed(2)} {r.etf}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/get-key"
              className="inline-flex items-center px-4 py-2 bg-[#002a5e] text-white text-sm font-medium rounded-lg hover:bg-[#003d7a] transition"
            >
              Get API Key — $20 credit
            </Link>
            <Link
              href="/docs/agent-integration"
              className="inline-flex items-center px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
            >
              Ask Claude or ChatGPT for your hedge
            </Link>
          </div>
        </section>
      )}

      {/* ── Daily return attribution (returns decomposition) ─────── */}
      {showReturnDecomp && (
        <section className="max-w-6xl mx-auto px-8 pb-8">
          <h2 className="text-lg font-semibold text-slate-700 mb-1">
            Daily return attribution ({teo})
          </h2>
          <p className="text-sm text-slate-500 mb-4 max-w-3xl">
            Incremental factor returns (<code className="text-xs bg-slate-200 px-1 rounded">l1_fr</code>,{" "}
            <code className="text-xs bg-slate-200 px-1 rounded">l2_fr</code>,{" "}
            <code className="text-xs bg-slate-200 px-1 rounded">l3_fr</code>) and L3 residual return (
            <code className="text-xs bg-slate-200 px-1 rounded">l3_rr</code>) from ERM3 returns decomposition — not hedge
            ratios or explained risk. See{" "}
            <Link href="/docs/returns-decomposition-metrics" className="text-[#002a5e] font-medium underline">
              Returns decomposition metrics
            </Link>
            .
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {frParts.map((p) => (
              <MetricCard key={p.key} label={p.key} value={fmtSignedBps(p.v)} />
            ))}
          </div>
          {metrics.returns_gross != null && !Number.isNaN(Number(metrics.returns_gross)) && (
            <p className="text-xs text-slate-500 mb-2">
              Gross return (same day):{" "}
              <span className="font-mono font-medium text-slate-700">{fmtSignedBps(metrics.returns_gross)}</span> — sum of
              components ≈ gross for simple daily returns.
            </p>
          )}
          <div className="flex h-10 w-full max-w-2xl rounded-lg overflow-hidden border border-slate-200 shadow-sm">
            {frParts.map((p) => {
              const n = Number(p.v);
              const abs = Math.abs(Number.isFinite(n) ? n : 0);
              const flex = Math.max(abs / sumAbsFr, 0.02);
              const positive = n >= 0;
              return (
                <div
                  key={p.key}
                  title={`${p.key}: ${fmtSignedBps(p.v)}`}
                  className={`${p.bg} ${positive ? "" : "opacity-70"} flex min-w-0 items-center justify-center text-[10px] font-semibold text-white`}
                  style={{ flex: `${flex} 1 0%` }}
                >
                  {flex > 0.12 ? p.key.replace(" FR", "").replace("L3 ", "") : ""}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Deep Dive Snapshot ──────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 pb-8">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">
          Deep Dive Snapshot
        </h2>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${GCS_BASE}/${upper}/${upper}_DD_latest.png`}
            alt={`${upper} Deep Dive Snapshot`}
            width={2200}
            height={1700}
            className="w-full rounded-lg"
          />
        </div>
        <div className="mt-4 flex gap-4">
          <a
            href={`${GCS_BASE}/${upper}/${upper}_DD_latest.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2 bg-[#002a5e] text-white text-sm font-medium rounded-lg hover:bg-[#003d7a] transition"
          >
            Open PDF
          </a>
          <a
            href={`${GCS_BASE}/${upper}/${upper}_DD_latest.pdf`}
            download
            className="inline-flex items-center px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            Download PDF
          </a>
          <a
            href={`${GCS_BASE}/${upper}/${upper}_DD_latest.png`}
            download
            className="inline-flex items-center px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            Download PNG
          </a>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 py-4 px-8 text-center text-xs text-slate-400">
        ERM3 V3 · riskmodels.app · BW Macro · Not Investment Advice
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p
        className={`text-lg font-bold mt-1 ${accent ? "text-emerald-600" : "text-slate-800"}`}
      >
        {value}
      </p>
    </div>
  );
}

