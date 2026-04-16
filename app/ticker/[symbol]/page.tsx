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
  market_cap: number | null;
  price_close: number | null;
  vol_23d: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
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
  "vol_23d", "price_close", "market_cap",
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
      market_cap: m.market_cap ?? null,
      price_close: m.price_close ?? null,
      vol_23d: m.vol_23d ?? null,
      l3_mkt_hr: m.l3_mkt_hr ?? null,
      l3_sec_hr: m.l3_sec_hr ?? null,
      l3_sub_hr: m.l3_sub_hr ?? null,
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
    description: `L3 factor risk decomposition, residual alpha quality, and subsector peer comparison for ${upper}.`,
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

function fmtPct(v: unknown, decimals = 1): string {
  if (v == null) return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : `${(n * 100).toFixed(decimals)}%`;
}

function fmtNum(v: unknown, decimals = 2): string {
  if (v == null) return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : n.toFixed(decimals);
}

function fmtCap(v: unknown): string {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
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

  const sysPct =
    resER != null
      ? (
          ((Math.abs(Number(metrics.l3_mkt_hr || 0)) +
            Math.abs(Number(metrics.l3_sec_hr || 0)) +
            Math.abs(Number(metrics.l3_sub_hr || 0))) /
            (Math.abs(Number(metrics.l3_mkt_hr || 0)) +
              Math.abs(Number(metrics.l3_sec_hr || 0)) +
              Math.abs(Number(metrics.l3_sub_hr || 0)) +
              Math.abs(Number(resER)))) *
          100
        ).toFixed(0)
      : null;

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
          <MetricCard label="Last Price" value={`$${fmtNum(metrics.price_close)}`} />
          <MetricCard label="Market Cap" value={fmtCap(metrics.market_cap)} />
          <MetricCard label="Vol (23d)" value={fmtPct(vol)} />
          <MetricCard label="L3 Res ER (α)" value={fmtPct(resER)} accent />
          <MetricCard label="Subsector" value={subEtf} />
          {sysPct && <MetricCard label="Systematic %" value={`${sysPct}%`} />}
        </div>
      </section>

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
        ERM3 V3 · riskmodels.app · BW Macro · Confidential · Not Investment
        Advice
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

