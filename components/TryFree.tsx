"use client";

import { useState } from "react";
import { Zap, Copy, Check } from "lucide-react";
import Link from "next/link";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_API_KEY ?? null;

/**
 * Aligns with Risk_Models billing: $20 starter credit; one-time low-balance email when
 * balance drops below $5 (`LOW_BALANCE_THRESHOLD_USD` in sibling repo
 * `Risk_Models/riskmodels_com/src/lib/agent/billing.ts`).
 */
const PRICING_BADGE =
  "$0 upfront · Baseline & Premium · $20 credits · Usage-based · $5 low-balance email";

export default function TryFree() {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, id: string) {
    void copyTextToClipboard(text).then((ok) => {
      if (ok) {
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
      }
    });
  }

  const curlCmd = DEMO_KEY
    ? `curl "https://riskmodels.app/api/tickers?mag7=true" -H "Authorization: Bearer ${DEMO_KEY}"`
    : "";

  if (!DEMO_KEY) {
    return (
      <section className="relative w-full border-t border-white/5 bg-transparent px-4 pt-8 pb-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-3 flex max-w-xl flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-semibold text-emerald-400">
            <Zap size={12} className="shrink-0" />
            <span>{PRICING_BADGE}</span>
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tighter text-white sm:text-3xl">
            Try it free
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-zinc-400">
            Sign in to get a key (card on file for billing). Baseline calls start around
            $0.001–$0.005; Premium covers L3 decomposition, portfolio indexing, batch analytics, and
            PDFs. No subscription or upfront fee.
          </p>
          <Link
            href="/get-key"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all text-sm"
          >
            <Zap size={16} /> Get Free API Key
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="relative w-full border-t border-white/5 bg-transparent px-4 pt-8 pb-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex max-w-xl flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-semibold text-emerald-400">
            <Zap size={12} className="shrink-0" />
            <span>{PRICING_BADGE}</span>
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tighter text-white sm:text-3xl">
            Try it free in 30 seconds
          </h2>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-xl mx-auto">
            Use the public demo key below—no signup. Full universe access uses the same Baseline &
            Premium per-call pricing (card on file; no upfront charge).
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          {/* Step 1 — Key */}
          <div className="p-6 border-b border-zinc-800">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                1
              </span>
              <span className="text-sm font-semibold text-zinc-100">
                Your public demo API key
              </span>
              <span className="ml-auto text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                MAG7 access
              </span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-950 border border-emerald-700/50 rounded-lg px-4 py-3">
              <code className="flex-1 text-emerald-400 text-sm font-mono truncate">
                {DEMO_KEY}
              </code>
              <button
                onClick={() => copy(DEMO_KEY, "key")}
                className="text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0 flex items-center gap-1 text-xs"
                title="Copy key"
              >
                {copied === "key" ? (
                  <>
                    <Check size={14} className="text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              Read-only · MAG7 tickers only · Rate limited
            </p>
          </div>

          {/* Step 2 — Curl */}
          <div className="p-6 border-b border-zinc-800">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                2
              </span>
              <span className="text-sm font-semibold text-zinc-100">
                Run this in your terminal
              </span>
              <span className="ml-auto text-xs text-zinc-600">
                returns MAG7 ticker list
              </span>
            </div>
            <div className="relative bg-zinc-950 border border-zinc-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
                <span className="text-xs text-zinc-600 font-mono">bash</span>
                <button
                  onClick={() => copy(curlCmd, "curl")}
                  className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors flex items-center gap-1"
                >
                  {copied === "curl" ? (
                    <>
                      <Check size={12} className="text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="px-4 py-4 text-sm text-zinc-300 font-mono overflow-x-auto whitespace-pre">
                {curlCmd}
              </pre>
            </div>
          </div>

          {/* Step 3 — What full access looks like */}
          <div className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-6 h-6 rounded-full bg-zinc-700 border border-zinc-600 text-zinc-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
                3
              </span>
              <span className="text-sm font-semibold text-zinc-100">
                With a full key — live risk metrics
              </span>
              <span className="ml-auto text-xs text-zinc-500">
                $0.005 / call
              </span>
            </div>
            <div className="relative bg-zinc-950 border border-zinc-700 rounded-lg overflow-hidden opacity-80">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
                <span className="text-xs text-zinc-600 font-mono">
                  GET /api/metrics/META → response
                </span>
              </div>
              <pre className="px-4 py-4 text-xs text-zinc-400 font-mono overflow-x-auto whitespace-pre">{`{
  "ticker": "META",
  "metrics": {
    "vol_23d":    0.392,
    "l3_mkt_hr":  1.284,   // short $1.28 SPY per $1 META
    "l3_sec_hr":  0.371,   // short $0.37 XLC per $1 META
    "l3_sub_hr":  0.198,   // short $0.20 subsector ETF
    "l3_mkt_er":  0.431,   // 43% variance from market
    "l3_sec_er":  0.089,   // 9% from sector
    "l3_sub_er":  0.043,   // 4% from subsector
    "l3_res_er":  0.437    // 44% idiosyncratic (alpha)
  }
}`}</pre>
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-zinc-600">
                Hedge ratios, decompositions, batch analysis, 15yr history.
              </p>
              <Link
                href="/get-key"
                className="text-xs text-primary hover:underline font-medium"
              >
                Get full access →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
