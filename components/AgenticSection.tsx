'use client';

import { ArrowRight, Bot, Terminal } from 'lucide-react';
import Link from 'next/link';

/** Maps marketing lines to shipped API / MCP capabilities (see OPENAPI_SPEC.yaml). */
const AGENTIC_CAPABILITY_STEPS: { label: string; mapsTo: string }[] = [
  {
    label: 'You delegate the job in natural language or from your stack',
    mapsTo: 'MCP /api/mcp/sse (tools/call) · OAuth2 agent keys · REST from automation',
  },
  {
    label: 'ERM3 factor decomposition & hedge ratios across holdings',
    mapsTo: 'POST /batch/analyze (full_metrics · hedge_ratios) · GET /metrics/{ticker} · GET /l3-decomposition',
  },
  {
    label: 'Drift vs targets lives in your policy layer',
    mapsTo: 'Daily fields via GET /ticker-returns & /metrics — you apply thresholds & alerts',
  },
  {
    label: 'Factor exposure & explained risk surfaced in structured JSON',
    mapsTo: 'L1/L2/L3 ER & HR in batch responses; lineage in _metadata',
  },
  {
    label: 'Portfolio hedge notionals from the same factor model',
    mapsTo: 'MCP hedge_portfolio · batch hedge_ratios · POST /estimate before spend',
  },
  {
    label: 'Machine-readable output for OMS, sheets, or copilots',
    mapsTo: 'JSON · optional Parquet/CSV on batch & returns routes',
  },
];

export default function AgenticSection() {
  return (
    <section className="relative w-full py-24 lg:py-32 px-4 sm:px-6 lg:px-8 bg-zinc-950 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/35 to-transparent"
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-b from-blue-950/[0.07] via-transparent to-transparent pointer-events-none" />

      <div className="relative max-w-6xl mx-auto">
        <div className="text-center mb-14 lg:mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-tighter mb-4">
            What Makes It <span className="text-primary">Agentic</span>
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            Traditional APIs give you data. You do the work. RiskModels does the work for you.
          </p>
        </div>

        {/* Comparison — Traditional | VS | Agentic */}
        <div className="flex flex-col md:flex-row md:items-stretch gap-6 md:gap-0 mb-16 lg:mb-20">
          {/* Traditional API — muted */}
          <div className="flex-1 min-w-0 p-7 lg:p-8 rounded-2xl md:rounded-r-none border border-zinc-800/80 bg-zinc-950/80 opacity-[0.82] saturate-[0.65] contrast-[0.97] md:border-r-0">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800">
                <Terminal className="text-zinc-500" size={22} />
              </div>
              <h3 className="text-lg font-semibold text-zinc-500 tracking-tight">Traditional APIs</h3>
            </div>

            <p className="text-xs uppercase tracking-wider text-zinc-600 mb-5 font-medium">You own every step</p>

            <ul className="space-y-3.5">
              {[
                'You construct the query payload',
                'You call the endpoint',
                'You parse the response',
                'You interpret factor weights',
                'You compute drift vs benchmark',
                'You decide what hedge to use',
                'You implement the trade',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-zinc-500 leading-relaxed">
                  <span className="text-zinc-700 mt-0.5 font-mono text-xs">→</span>
                  {step}
                </li>
              ))}
            </ul>

            <div className="mt-8 pt-5 border-t border-zinc-800/60">
              <p className="text-zinc-600 text-sm leading-relaxed">
                You = the risk engine. API = a data pipe.
              </p>
            </div>
          </div>

          {/* VS + pulse divider (md+) */}
          <div className="hidden md:flex flex-col items-center justify-center shrink-0 w-16 lg:w-[4.5rem] relative self-stretch">
            <div
              className="absolute top-10 bottom-10 w-px left-1/2 -translate-x-1/2 bg-gradient-to-b from-transparent via-primary/35 to-transparent animate-pulse"
              aria-hidden
            />
            <span className="relative z-[1] inline-flex items-center justify-center w-11 h-11 rounded-full border border-zinc-700 bg-zinc-900/90 text-[11px] font-bold tracking-widest text-zinc-400 shadow-lg shadow-black/40">
              VS
            </span>
          </div>

          <div className="md:hidden flex justify-center py-1">
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-bold tracking-widest text-zinc-500">
              VS
            </span>
          </div>

          {/* Agentic — emphasis */}
          <div className="flex-1 min-w-0 p-7 lg:p-8 rounded-2xl md:rounded-l-none border border-primary/35 bg-gradient-to-br from-primary/[0.08] via-zinc-950/90 to-zinc-950 shadow-[0_0_0_1px_rgba(59,130,246,0.12),0_0_72px_-12px_rgba(59,130,246,0.35),0_0_120px_-40px_rgba(59,130,246,0.2)] md:border-l-0 relative">
            <div
              className="pointer-events-none absolute inset-0 rounded-2xl md:rounded-l-none ring-1 ring-inset ring-primary/20"
              aria-hidden
            />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 shadow-[0_0_24px_-4px_rgba(59,130,246,0.5)]">
                  <Bot className="text-primary" size={22} />
                </div>
                <h3 className="text-lg font-semibold text-white tracking-tight">RiskModels Agentic</h3>
              </div>

              <p className="text-xs uppercase tracking-wider text-primary/80 mb-6 font-medium leading-relaxed">
                You own the outcome
              </p>

              <ul className="space-y-4">
                {AGENTIC_CAPABILITY_STEPS.map((step, i) => (
                  <li key={i} className="text-sm text-zinc-200 leading-relaxed">
                    <div className="flex items-start gap-3">
                      <span className="text-primary mt-0.5 shrink-0">✓</span>
                      <span>{step.label}</span>
                    </div>
                    <p className="mt-1.5 ml-7 text-[11px] sm:text-xs font-mono text-zinc-500 leading-relaxed">
                      {step.mapsTo}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="mt-8 pt-5 border-t border-primary/25">
                <p className="text-zinc-300 text-sm leading-relaxed">
                  You = the decision-maker. API = the risk engine.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Code Example */}
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 overflow-hidden backdrop-blur-sm">
          <div className="px-6 py-4 border-b border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <span className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-zinc-600 font-mono">agentic-workflow.sh</span>
          </div>
          <div className="p-6 overflow-x-auto">
            <pre className="text-sm font-mono leading-relaxed">
              <code className="text-zinc-300">
                <span className="text-zinc-500">{'# Install the CLI'}</span>
                <br />
                <span className="text-emerald-400">$ npm install -g riskmodels-cli</span>
                <br />
                <br />
                <span className="text-zinc-500">{'# Configure your API key'}</span>
                <br />
                <span className="text-white">$ riskmodels</span>{' '}
                <span className="text-blue-400">config</span>{' '}
                <span className="text-zinc-500">set apiKey rm_live_...</span>
                <br />
                <br />
                <span className="text-zinc-500">{'# Multi-ticker metrics + hedges (see Quickstart § batch)'}</span>
                <br />
                <span className="text-white">$ curl -X POST</span>{' '}
                <span className="text-blue-400">https://riskmodels.app/api/batch/analyze</span>
                <span className="text-zinc-500"> ...</span>
                <br />
                <br />
                <span className="text-zinc-500">{'# MCP: analyze_portfolio · hedge_portfolio (OpenAPI + /.well-known/mcp.json)'}</span>
                <br />
                <span className="text-zinc-500">{'# → Per-ticker L3 hedge ratios & explained risk in JSON'}</span>
                <br />
                <span className="text-zinc-500">{'# → POST /estimate previews token cost before batch runs'}</span>
              </code>
            </pre>
          </div>
        </div>

        <div className="text-center mt-12">
          <Link
            href="/quickstart"
            className="group inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all shadow-lg shadow-primary/15"
          >
            Try the Agentic API
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
