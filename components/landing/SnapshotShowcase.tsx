"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const STOCKS = [
  { ticker: "NVDA", name: "NVIDIA", color: "#4f46e5" },
  { ticker: "AAPL", name: "Apple", color: "#1d4ed8" },
  { ticker: "MSFT", name: "Microsoft", color: "#059669" },
  { ticker: "AMZN", name: "Amazon", color: "#d97706" },
  { ticker: "GOOGL", name: "Alphabet", color: "#dc2626" },
  { ticker: "META", name: "Meta", color: "#2563eb" },
  { ticker: "AMD", name: "AMD", color: "#7c3aed" },
] as const;

export default function SnapshotShowcase() {
  const [active, setActive] = useState(0);
  const stock = STOCKS[active];

  return (
    <section className="py-20 px-4 sm:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400 mb-3">
            Stock Deep Dive
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Institutional-Grade Risk Snapshots
          </h2>
          <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
            One-page PDF combining L3 factor decomposition, residual alpha
            quality, and subsector peer comparison — generated for any stock in
            seconds.
          </p>
        </div>

        {/* Ticker pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {STOCKS.map((s, i) => (
            <button
              key={s.ticker}
              onClick={() => setActive(i)}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                i === active
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {s.ticker}
            </button>
          ))}
        </div>

        {/* Snapshot preview */}
        <div className="relative group">
          <Link href={`/ticker/${stock.ticker.toLowerCase()}`}>
            <div className="relative rounded-xl overflow-hidden border border-zinc-700/50 shadow-2xl shadow-black/40 transition-transform group-hover:scale-[1.005]">
              <Image
                src={`/snapshots/${stock.ticker}_dd.png`}
                alt={`${stock.ticker} Stock Deep Dive snapshot`}
                width={3300}
                height={2550}
                className="w-full h-auto"
                priority={active === 0}
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-8">
                <span className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold text-sm shadow-lg">
                  Open {stock.ticker} Interactive Dashboard →
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* CTA row */}
        <div className="flex justify-center gap-4 mt-8">
          <Link
            href={`/ticker/${stock.ticker.toLowerCase()}`}
            className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500 transition"
          >
            View {stock.ticker} Dashboard
          </Link>
          <Link
            href={`/api/metrics/${stock.ticker}/snapshot.pdf`}
            className="inline-flex items-center px-5 py-2.5 border border-zinc-600 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition"
          >
            Download PDF
          </Link>
        </div>
      </div>
    </section>
  );
}
