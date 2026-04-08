/**
 * /ticker/[symbol] — Dynamic Ticker Dashboard
 *
 * Entry point from PDF snapshot QR codes and footer links.
 * Fetches live metrics from the internal API and renders a minimal
 * interactive dashboard. Supports ?ref= for tracking and ?focus= for
 * auto-opening specific panels.
 *
 * @example https://riskmodels.app/ticker/nvda
 * @example https://riskmodels.app/ticker/nvda?ref=snapshot_2026-04-06&focus=risk-dna
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TickerMetrics {
  ticker: string;
  company_name?: string;
  teo?: string;
  sector_etf?: string;
  subsector_etf?: string;
  market_cap?: number;
  close_price?: number;
  vol_23d?: number;
  l3_market_hr?: number;
  l3_sector_hr?: number;
  l3_subsector_hr?: number;
  l3_residual_er?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Data fetching (server-side)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

async function getTickerMetrics(symbol: string): Promise<TickerMetrics | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/metrics/${symbol.toUpperCase()}`, {
      next: { revalidate: 300 }, // cache 5 min
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
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
  return {
    title: `${upper} — Stock Deep Dive | RiskModels`,
    description: `L3 factor risk decomposition, residual alpha quality, and subsector peer comparison for ${upper}.`,
    openGraph: {
      title: `${upper} Deep Dive`,
      description: `Institutional risk analytics for ${upper} — powered by ERM3 V3.`,
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

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function TickerDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ ref?: string; focus?: string }>;
}) {
  const { symbol } = await params;
  const { ref, focus } = await searchParams;
  const upper = symbol.toUpperCase();

  const metrics = await getTickerMetrics(upper);
  if (!metrics) return notFound();

  const companyName = metrics.company_name || upper;
  const teo = metrics.teo || "—";
  const subEtf = metrics.subsector_etf || metrics.sector_etf || "—";

  const resER = metrics.l3_residual_er;
  const vol = metrics.vol_23d;
  const sysPct =
    resER != null
      ? (
          ((Math.abs(Number(metrics.l3_market_hr || 0)) +
            Math.abs(Number(metrics.l3_sector_hr || 0)) +
            Math.abs(Number(metrics.l3_subsector_hr || 0))) /
            (Math.abs(Number(metrics.l3_market_hr || 0)) +
              Math.abs(Number(metrics.l3_sector_hr || 0)) +
              Math.abs(Number(metrics.l3_subsector_hr || 0)) +
              Math.abs(Number(resER)))) *
          100
        ).toFixed(0)
      : null;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="bg-[#002a5e] text-white px-8 py-6">
        <div className="max-w-6xl mx-auto">
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
      </header>

      {/* ── Metric Cards ────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <MetricCard label="Last Price" value={`$${fmtNum(metrics.close_price)}`} />
          <MetricCard label="Market Cap" value={fmtCap(metrics.market_cap)} />
          <MetricCard label="Vol (23d)" value={fmtPct(vol)} />
          <MetricCard label="L3 Res ER (α)" value={fmtPct(resER)} accent />
          <MetricCard label="Subsector" value={subEtf} />
          {sysPct && <MetricCard label="Systematic %" value={`${sysPct}%`} />}
        </div>
      </section>

      {/* ── Panel Links ─────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 pb-8">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">
          Interactive Panels
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          <PanelLink
            title="I. Cumulative Returns"
            description="1Y total return vs SPY, sector, subsector + residual α"
            active={focus === "returns"}
          />
          <PanelLink
            title="II. Residual Alpha Quality"
            description="Peer scatter: L3 residual return vs residual vol"
            active={focus === "alpha-quality"}
          />
          <PanelLink
            title="III. Subsector Risk DNA"
            description="σ-scaled factor decomposition vs top 6 peers"
            active={focus === "risk-dna"}
          />
        </div>
      </section>

      {/* ── PDF Download ────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 pb-12">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Snapshot Reports
          </h3>
          <div className="flex gap-4">
            <a
              href={`/api/metrics/${upper}/snapshot.pdf`}
              className="inline-flex items-center px-4 py-2 bg-[#002a5e] text-white text-sm font-medium rounded-lg hover:bg-[#003d7a] transition"
            >
              Download R1 PDF
            </a>
            <a
              href={`/api/pdf/${symbol.toLowerCase()}/latest`}
              className="inline-flex items-center px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
            >
              Latest Deep Dive PDF
            </a>
          </div>
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

function PanelLink({
  title,
  description,
  active,
}: {
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 transition ${
        active
          ? "border-indigo-500 bg-indigo-50 shadow-md"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="text-sm text-slate-500 mt-1">{description}</p>
      {active && (
        <span className="inline-block mt-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
          Active
        </span>
      )}
    </div>
  );
}
