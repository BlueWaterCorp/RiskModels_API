'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

const MAG7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'] as const;
type Mag7 = (typeof MAG7)[number];

interface Layer {
  er: number | null;
  hr: number | null;
  hedge_etf: string | null;
}

interface DecomposeBody {
  ticker: string;
  data_as_of?: string;
  exposure: {
    market: Layer;
    sector: Layer;
    subsector: Layer;
    residual: Layer;
  };
  hedge: Record<string, number>;
}

const LAYER_META: Array<{ key: keyof DecomposeBody['exposure']; label: string; color: string }> = [
  { key: 'market',    label: 'Market',    color: 'bg-blue-500' },
  { key: 'sector',    label: 'Sector',    color: 'bg-teal-500' },
  { key: 'subsector', label: 'Subsector', color: 'bg-cyan-500' },
  { key: 'residual',  label: 'Residual',  color: 'bg-emerald-500' },
];

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function signedPlus(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

export default function DecomposeWidget() {
  const [ticker, setTicker] = useState<Mag7>('NVDA');
  const [body, setBody] = useState<DecomposeBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/landing/decompose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
        if (!cancelled) setBody(json as DecomposeBody);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Request failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return (
    <section
      id="decompose-widget"
      className="relative scroll-mt-20 bg-zinc-950 px-4 pb-16 pt-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-zinc-950/70 p-5 shadow-[0_24px_70px_-28px_rgba(0,0,0,0.6)] ring-1 ring-white/5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              Decompose a position <span className="text-primary">live.</span>
            </h2>
            <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
              MAG7 preview &mdash; no API key required. For the full universe,{' '}
              <a href="/get-key" className="text-primary underline-offset-2 hover:underline">
                get a key
              </a>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MAG7.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTicker(t)}
                className={
                  'rounded-md border px-3 py-1.5 text-sm font-semibold transition ' +
                  (t === ticker
                    ? 'border-primary bg-primary text-white'
                    : 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10')
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {/* Exposure bars */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
                Exposure (four bets)
              </h3>
              {body?.data_as_of && (
                <span className="font-mono text-[11px] text-zinc-500">
                  as of {body.data_as_of}
                </span>
              )}
            </div>

            {loading && (
              <div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
                <Loader2 size={16} className="animate-spin" />
                Fetching {ticker}…
              </div>
            )}
            {!loading && error && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {!loading && !error && body && (
              <ul className="space-y-3">
                {LAYER_META.map(({ key, label, color }) => {
                  const layer = body.exposure[key];
                  const er = layer.er ?? 0;
                  const pct = Math.max(2, Math.round(er * 100));
                  return (
                    <li key={key}>
                      <div className="mb-1 flex justify-between text-xs text-zinc-300">
                        <span>
                          {label}
                          {layer.hedge_etf && (
                            <span className="ml-2 font-mono text-[11px] text-zinc-500">
                              → {layer.hedge_etf}
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-zinc-400">
                          er {fmt(layer.er)}
                          {layer.hr !== null && (
                            <span className="ml-2">hr {signedPlus(layer.hr)}</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Hedge map */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400">
              Hedge map (per $1 long)
            </h3>
            {loading && (
              <div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
                <Loader2 size={16} className="animate-spin" />
                Computing hedge notionals…
              </div>
            )}
            {!loading && !error && body && (
              <>
                <ul className="space-y-2">
                  {Object.entries(body.hedge).map(([etf, ratio]) => (
                    <li
                      key={etf}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900/50 px-4 py-2.5"
                    >
                      <span className="font-mono text-sm font-semibold text-white">
                        {etf}
                      </span>
                      <span
                        className={
                          'font-mono text-sm ' +
                          (ratio < 0 ? 'text-rose-300' : 'text-emerald-300')
                        }
                      >
                        {signedPlus(ratio, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
                  Negative = short the ETF per $1 long stock. Positive = long
                  the ETF (e.g. when the stock&rsquo;s market HR is negative).
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
