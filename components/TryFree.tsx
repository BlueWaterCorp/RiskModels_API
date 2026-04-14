"use client";

import { useState } from "react";
import { Zap, Copy, Check } from "lucide-react";
import Link from "next/link";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

/**
 * Aligns with Risk_Models billing: $20 starter credit; one-time low-balance email when
 * balance drops below $5 (`LOW_BALANCE_THRESHOLD_USD` in sibling repo
 * `Risk_Models/riskmodels_com/src/lib/agent/billing.ts`).
 */
const PRICING_BADGE =
  "$0 upfront · Baseline & Premium · $20 credits · Usage-based · $5 low-balance email";

/** MAG7 list is public — no API key required (see app/api/tickers/route.ts mag7 path). */
const PUBLIC_MAG7_CURL = `curl "https://riskmodels.app/api/tickers?mag7=true"`;

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

  return (
    <section className="relative w-full border-t border-white/5 bg-transparent px-4 pt-8 pb-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex max-w-xl flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-semibold text-emerald-400">
            <Zap size={12} className="shrink-0" />
            <span>{PRICING_BADGE}</span>
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tighter text-white sm:text-3xl">
            Try it in seconds
          </h2>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-zinc-400">
            Fetch the public MAG7 ticker list with no signup. Metrics, balance, batch, and the
            Quickstart notebook need a registered key (
            <code className="text-zinc-500">rm_user_*</code> /{" "}
            <code className="text-zinc-500">rm_agent_*</code>) from{" "}
            <Link href="/get-key" className="text-primary hover:underline">
              Get key
            </Link>
            .
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
          <div className="border-b border-zinc-800 p-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/20 text-xs font-bold text-primary">
                1
              </span>
              <span className="text-sm font-semibold text-zinc-100">
                Public MAG7 tickers — no API key
              </span>
              <span className="ml-auto text-xs text-zinc-600">returns JSON list</span>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                <span className="font-mono text-xs text-zinc-600">bash</span>
                <button
                  type="button"
                  onClick={() => copy(PUBLIC_MAG7_CURL, "curl")}
                  className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
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
              <pre className="overflow-x-auto whitespace-pre px-4 py-4 font-mono text-sm text-zinc-300">
                {PUBLIC_MAG7_CURL}
              </pre>
            </div>
          </div>

          <div className="p-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-700 text-xs font-bold text-zinc-400">
                2
              </span>
              <span className="text-sm font-semibold text-zinc-100">
                With a full key — live risk metrics
              </span>
              <span className="ml-auto text-xs text-zinc-500">from $0.001 / call</span>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 opacity-90">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                <span className="font-mono text-xs text-zinc-600">
                  GET /api/metrics/META → response
                </span>
              </div>
              <pre className="overflow-x-auto whitespace-pre px-4 py-4 font-mono text-xs text-zinc-400">{`{
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
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-600">
                Hedge ratios, decompositions, batch analysis, 15yr history.
              </p>
              <Link
                href="/get-key"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                <Zap size={16} /> Get free API key
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
