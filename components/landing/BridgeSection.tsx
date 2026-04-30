"use client";

import { useEffect, useState } from "react";

/**
 * Bridge between Chart 1 (single-stock decomposition) and Chart 2 (portfolio
 * concentration + replicate/hedge). Pulls the live cap-weighted ETF hedges
 * from /api/landing/concentration so the values shown here are the SAME
 * numbers Chart 2 RIGHT will display.
 */

type EtfHedge = {
  etf: string;
  layer: "market" | "sector" | "subsector";
  hedge_ratio: number;
  dollars: number;
};

type Payload = {
  cap_etf_hedges?: EtfHedge[];
};

const LAYER_ORDER: EtfHedge["layer"][] = ["market", "sector", "subsector"];

function pickTopPerLayer(rows: EtfHedge[]): EtfHedge[] {
  const out: EtfHedge[] = [];
  for (const layer of LAYER_ORDER) {
    const candidates = rows.filter((r) => r.layer === layer);
    if (!candidates.length) continue;
    candidates.sort(
      (a, b) => Math.abs(b.hedge_ratio) - Math.abs(a.hedge_ratio),
    );
    out.push(candidates[0]);
  }
  return out;
}

export default function BridgeSection() {
  const [hedges, setHedges] = useState<EtfHedge[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/landing/concentration")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: Payload | null) => {
        if (cancelled || !payload?.cap_etf_hedges) return;
        setHedges(pickTopPerLayer(payload.cap_etf_hedges));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border-b border-zinc-800/80 bg-zinc-950 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          From exposure to action
        </p>
        <p className="mt-3 text-xl leading-snug text-zinc-200 sm:text-2xl">
          Once risk is fully decomposed, hedge ratios follow directly.
        </p>
        <p className="mt-2 text-base leading-relaxed text-zinc-400 sm:text-lg">
          Each layer maps to a tradable ETF — returned in one call.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-sm sm:text-base">
          {hedges
            ? hedges.map((h) => (
                <span key={h.etf} className="inline-flex items-baseline gap-2">
                  <span className="font-semibold text-white">{h.etf}</span>
                  <span className={h.hedge_ratio < 0 ? "text-red-300" : "text-emerald-300"}>
                    {h.hedge_ratio >= 0 ? "+" : ""}
                    {h.hedge_ratio.toFixed(2)}
                  </span>
                </span>
              ))
            : (
              <span className="text-zinc-600">Loading hedge ratios…</span>
            )}
        </div>
      </div>
    </section>
  );
}
