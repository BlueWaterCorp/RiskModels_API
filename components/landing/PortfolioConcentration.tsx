"use client";

import { useEffect, useMemo, useState } from "react";
import { ATTRIBUTION_HEX } from "@/lib/landing/attributionColors";

/**
 * Portfolio concentration — Chart 2 of the landing page.
 *
 * LEFT  = Marimekko (per-ticker σ × cap-weight). Same data as the cap-weighted
 *         portfolio shown on the right.
 * RIGHT = Replicate / hedge workflow. Risk decomposition stack →
 *         replicable-vs-residual annotation → ETF mapping (HR × $1M) →
 *         hedge selection chips (static) → remaining-exposure bar.
 *
 * RIGHT is derived from the SAME cap-weighted variance decomposition as LEFT;
 * ETF dollar amounts come from the cap-weighted Σ_i w_i · l3_*_hr aggregated
 * by `sector_etf` / `subsector_etf` (Market always = SPY).
 */

const LAYER_COLORS = {
  market: ATTRIBUTION_HEX.market.up,
  sector: ATTRIBUTION_HEX.sector.up,
  subsector: ATTRIBUTION_HEX.subsector.up,
  residual: ATTRIBUTION_HEX.residual.up,
} as const;

// Right panel uses a slightly more saturated Residual to make it visually
// pop as "this is what remains" — the key idea of the workflow.
const RIGHT_LAYER_COLORS = {
  ...LAYER_COLORS,
  residual: "#34D399",
} as const;

const LAYER_ORDER = ["market", "sector", "subsector", "residual"] as const;
type LayerKey = (typeof LAYER_ORDER)[number];

const LAYER_LABEL: Record<LayerKey, string> = {
  market: "Market",
  sector: "Sector",
  subsector: "Subsector",
  residual: "Residual",
};

const HEDGEABLE: LayerKey[] = ["market", "sector", "subsector"];
const DEFAULT_HEDGED: LayerKey[] = ["market", "sector"];

interface ConcentrationTicker {
  ticker: string;
  name: string | null;
  market_cap: number | null;
  l3_mkt_er: number;
  l3_sec_er: number;
  l3_sub_er: number;
  l3_res_er: number;
  l3_mkt_hr: number;
  l3_sec_hr: number;
  l3_sub_hr: number;
  total_er: number;
  sigma: number;
  sector_etf: string | null;
  subsector_etf: string | null;
}

interface LayerER {
  market_er: number;
  sector_er: number;
  subsector_er: number;
  residual_er: number;
  total: number;
}

interface PortfolioBlock {
  weights: Record<string, number>;
  naive: LayerER;
  adjusted: LayerER;
  variance_naive: number;
  variance_adjusted: number;
  sigma_naive: number;
  sigma_adjusted: number;
  redundancy_pct: number;
}

interface EtfHedge {
  etf: string;
  layer: "market" | "sector" | "subsector";
  hedge_ratio: number;
  dollars: number;
}

interface ConcentrationPayload {
  tickers: string[];
  per_ticker: Record<string, ConcentrationTicker>;
  portfolios: {
    equal_weight: PortfolioBlock;
    cap_weighted: PortfolioBlock | null;
  };
  cap_etf_hedges: EtfHedge[];
  notional_usd: number;
  data_as_of: string;
}

interface CapRow {
  ticker: string;
  name: string | null;
  capWeight: number;
  sigma: number;
  shares: Record<LayerKey, number>;
}

const ENDPOINT = "/api/landing/concentration";

export default function PortfolioConcentration() {
  const [data, setData] = useState<ConcentrationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ENDPOINT, { method: "GET" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ConcentrationPayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border-b border-zinc-800/80 bg-zinc-950 px-4 pb-20 pt-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-2 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Portfolio risk
          </p>
          <h2 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl md:text-6xl">
            Your Portfolio has a Benchmark -
            <br />
            You just haven&rsquo;t seen it
          </h2>
        </div>

        {error && (
          <p className="mt-12 text-center text-sm text-red-400">
            Failed to load concentration data: {error}
          </p>
        )}

        {!data && !error && (
          <div className="mt-12 flex h-[420px] items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        )}

        {data && <ChartBody data={data} />}

        {data && (
          <p className="mt-8 text-center text-base leading-relaxed text-zinc-400 sm:text-lg">
            Market-cap weighting concentrates exposure. It doesn&rsquo;t diversify it.
          </p>
        )}

        {data?.data_as_of && (
          <p className="mt-4 text-center text-[11px] uppercase tracking-wider text-zinc-600">
            Data as of {data.data_as_of}
          </p>
        )}
      </div>
    </section>
  );
}

// ── Chart body (post-fetch) ───────────────────────────────────────────────

function ChartBody({ data }: { data: ConcentrationPayload }) {
  const { tickers, per_ticker, portfolios, cap_etf_hedges, notional_usd } = data;
  const cap = portfolios.cap_weighted;

  const capRows = useMemo<CapRow[]>(() => {
    const totalCap = tickers.reduce(
      (sum, t) => sum + (per_ticker[t]?.market_cap ?? 0),
      0,
    );
    if (totalCap <= 0) return [];
    return tickers
      .map((t) => {
        const row = per_ticker[t];
        const c = row?.market_cap ?? 0;
        return {
          ticker: t,
          name: row?.name ?? null,
          capWeight: c / totalCap,
          sigma: row?.sigma ?? 0,
          shares: normalizeShares(row),
        };
      })
      .filter((r) => r.capWeight > 0)
      .sort((a, b) => b.capWeight - a.capWeight);
  }, [tickers, per_ticker]);

  const sigmaMaxTicker = capRows.reduce((m, r) => Math.max(m, r.sigma), 0);
  const sharedSigmaMax = niceCeil5(Math.max(sigmaMaxTicker, cap?.sigma_naive ?? 0) * 1.06);

  if (!cap) {
    return (
      <Marimekko rows={capRows} xMax={sharedSigmaMax} />
    );
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <Marimekko rows={capRows} xMax={sharedSigmaMax} />
      <ReplicateHedgePanel
        block={cap}
        etfHedges={cap_etf_hedges}
        notional={notional_usd}
      />
    </div>
  );
}

function normalizeShares(row: ConcentrationTicker | undefined): Record<LayerKey, number> {
  if (!row) return { market: 0, sector: 0, subsector: 0, residual: 0 };
  const raw = {
    market: clampNonNeg(row.l3_mkt_er),
    sector: clampNonNeg(row.l3_sec_er),
    subsector: clampNonNeg(row.l3_sub_er),
    residual: clampNonNeg(row.l3_res_er),
  };
  const total = raw.market + raw.sector + raw.subsector + raw.residual;
  if (total <= 1e-9) return { market: 0, sector: 0, subsector: 0, residual: 0 };
  return {
    market: raw.market / total,
    sector: raw.sector / total,
    subsector: raw.subsector / total,
    residual: raw.residual / total,
  };
}

function clampNonNeg(v: number): number {
  return v > 0 ? v : 0;
}

// ── LEFT: Marimekko ───────────────────────────────────────────────────────

function Marimekko({ rows, xMax }: { rows: CapRow[]; xMax: number }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-zinc-500">
        Cap weights unavailable.
      </div>
    );
  }
  const W = 720;
  const H = 480;
  const ML = 76;
  const MR = 24;
  const MT = 32;
  const MB = 56;
  const innerW = W - ML - MR;
  const innerH = H - MT - MB;

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-6">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Market-cap weighted portfolio
        </p>
        <h3 className="mt-1 text-sm font-semibold tracking-tight text-white">
          Per-stock risk
        </h3>
        <p className="text-xs text-zinc-500">
          Bar thickness = market-cap weight. Length = annualized σ.
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        role="img"
      >
        <MarimekkoBars
          rows={rows}
          xMax={xMax}
          ml={ML}
          mt={MT}
          mb={MB}
          innerW={innerW}
          innerH={innerH}
        />
      </svg>
      <Legend />
    </div>
  );
}

function MarimekkoBars({
  rows,
  xMax,
  ml,
  mt,
  innerW,
  innerH,
}: {
  rows: CapRow[];
  xMax: number;
  ml: number;
  mt: number;
  mb: number;
  innerW: number;
  innerH: number;
}) {
  const totalCapWeight = rows.reduce((s, r) => s + r.capWeight, 0) || 1;
  const gapPx = 6;
  const totalGap = gapPx * (rows.length - 1);
  const usableH = Math.max(0, innerH - totalGap);

  const MIN_ROW_PX = 14;
  const heights: number[] = rows.map((r) => {
    const raw = (r.capWeight / totalCapWeight) * usableH;
    return Math.max(MIN_ROW_PX, raw);
  });
  const sumHeights = heights.reduce((a, b) => a + b, 0);
  if (sumHeights > usableH) {
    const scale = usableH / sumHeights;
    for (let i = 0; i < heights.length; i++) heights[i] *= scale;
  }

  const baseX = ml;
  const baseY = mt;

  return (
    <>
      <line
        x1={baseX}
        x2={baseX + innerW}
        y1={baseY + innerH + 0.5}
        y2={baseY + innerH + 0.5}
        stroke="#475569"
        strokeWidth={0.5}
      />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const x = baseX + innerW * t;
        return (
          <g key={t}>
            <line
              x1={x}
              x2={x}
              y1={baseY}
              y2={baseY + innerH}
              stroke="#1f2937"
              strokeDasharray="2 4"
              strokeWidth={0.5}
            />
            <text
              x={x}
              y={baseY + innerH + 16}
              textAnchor="middle"
              fontSize={11}
              fill="#71717a"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {(xMax * t * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      <text
        x={baseX + innerW / 2}
        y={baseY + innerH + 36}
        textAnchor="middle"
        fontSize={11}
        fill="#a1a1aa"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Annualized σ — segments = σ × variance share
      </text>

      {rows.map((row, i) => {
        const yStart =
          baseY +
          heights.slice(0, i).reduce((a, b) => a + b, 0) +
          gapPx * i;
        const h = heights[i];
        const fullW = (row.sigma / xMax) * innerW;
        return (
          <MarimekkoRow
            key={row.ticker}
            row={row}
            x={baseX}
            y={yStart}
            fullW={fullW}
            h={h}
            labelX={baseX - 12}
          />
        );
      })}
    </>
  );
}

function MarimekkoRow({
  row,
  x,
  y,
  fullW,
  h,
  labelX,
}: {
  row: CapRow;
  x: number;
  y: number;
  fullW: number;
  h: number;
  labelX: number;
}) {
  const segments: { key: LayerKey; w: number; x: number }[] = [];
  let cursor = x;
  for (const key of LAYER_ORDER) {
    const segW = fullW * row.shares[key];
    segments.push({ key, w: segW, x: cursor });
    cursor += segW;
  }

  const tickerFont = Math.min(13, Math.max(10, h * 0.55));
  const capFont = 9;

  return (
    <g>
      <text
        x={labelX}
        y={y + h / 2 - capFont / 2}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize={tickerFont}
        fill="#e4e4e7"
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {row.ticker}
      </text>
      <text
        x={labelX}
        y={y + h / 2 + tickerFont * 0.7}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize={capFont}
        fill="#71717a"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {(row.capWeight * 100).toFixed(1)}%
      </text>
      {segments.map((s) =>
        s.w > 0.5 ? (
          <rect
            key={s.key}
            x={s.x}
            y={y}
            width={s.w}
            height={h}
            fill={LAYER_COLORS[s.key]}
          >
            <title>
              {row.ticker} · {LAYER_LABEL[s.key]}: {(row.shares[s.key] * row.sigma * 100).toFixed(1)}%
            </title>
          </rect>
        ) : null,
      )}
    </g>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-zinc-400">
      {LAYER_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: LAYER_COLORS[k] }}
          />
          {LAYER_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

// ── RIGHT: Replicate / hedge workflow ─────────────────────────────────────

function ReplicateHedgePanel({
  block,
  etfHedges,
  notional,
}: {
  block: PortfolioBlock;
  etfHedges: EtfHedge[];
  notional: number;
}) {
  // Variance shares of the cap-weighted portfolio (sum to 1.0). Convert each
  // to its σ-equivalent contribution by multiplying by σ_naive — that is, the
  // bar represents naive σ, with each segment proportional to its variance
  // share of the total. This is the SAME math the LEFT panel uses per-stock.
  const naive = block.naive;
  const sigmaNaive = block.sigma_naive;
  const total = naive.total > 1e-12 ? naive.total : 1;
  const shares: Record<LayerKey, number> = {
    market: clampNonNeg(naive.market_er) / total,
    sector: clampNonNeg(naive.sector_er) / total,
    subsector: clampNonNeg(naive.subsector_er) / total,
    residual: clampNonNeg(naive.residual_er) / total,
  };

  // Top ETF per layer for the SECTION 3 mapping table.
  const topPerLayer = useMemo(() => {
    const out: EtfHedge[] = [];
    for (const layer of HEDGEABLE) {
      const candidates = etfHedges
        .filter((h) => h.layer === layer)
        .sort((a, b) => Math.abs(b.hedge_ratio) - Math.abs(a.hedge_ratio));
      if (candidates[0]) out.push(candidates[0]);
    }
    return out;
  }, [etfHedges]);

  // Default hedge selection: Market + Sector. Subsector is hedgeable but not
  // hedged by default; Residual is never hedgeable.
  const hedged = new Set<LayerKey>(DEFAULT_HEDGED);
  const remainingShares = LAYER_ORDER.reduce<Record<LayerKey, number>>(
    (acc, k) => {
      acc[k] = hedged.has(k) ? 0 : shares[k];
      return acc;
    },
    { market: 0, sector: 0, subsector: 0, residual: 0 },
  );

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-5 sm:p-7">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400/80">
          Custom risk benchmark · tradable
        </p>
        <h3 className="mt-2 text-base font-semibold leading-snug tracking-tight text-white sm:text-lg">
          See your ETF risk replication. Hedge what you want. Keep the rest.
        </h3>
        <p className="mt-2 text-sm leading-snug text-zinc-400">
          Build a custom risk benchmark.
          <br />
          Choose what to beat.
        </p>
      </div>

      {/* Section 1: Risk decomposition */}
      <div className="mt-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Risk decomposition
        </p>
        <DecompositionBar shares={shares} sigma={sigmaNaive} colors={RIGHT_LAYER_COLORS} />
        <DecompositionLegend shares={shares} sigma={sigmaNaive} colors={RIGHT_LAYER_COLORS} />
      </div>

      {/* Section 2: Replicable vs Non-replicable annotation */}
      <div className="mt-7 grid grid-cols-2 gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-xs leading-snug">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            ETF-replicable
          </p>
          <p className="mt-1 text-zinc-300">Market · Sector · Subsector</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Residual
          </p>
          <p className="mt-1 text-zinc-300">Not hedgeable</p>
        </div>
      </div>

      {/* Section 3: ETF mapping */}
      <div className="mt-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Replicate with{" "}
          <span className="font-mono text-[10px] normal-case tracking-normal text-zinc-500">
            ({usdNotional(notional)} notional)
          </span>
        </p>
        <ul className="divide-y divide-white/5 rounded-md border border-white/5 bg-white/[0.02] font-mono text-sm">
          {topPerLayer.map((h) => (
            <li
              key={h.etf}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: RIGHT_LAYER_COLORS[h.layer] }}
                />
                <span className="font-semibold text-white">{h.etf}</span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {h.layer}
                </span>
              </span>
              <span className={h.dollars < 0 ? "text-red-300" : "text-emerald-300"}>
                {h.dollars >= 0 ? "+" : "−"}${absUsd(h.dollars)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          HR = ETF hedge ratios returned by the API. Negative dollars = short the ETF.
        </p>
        <p className="mt-1 font-mono text-[11px] text-zinc-500">
          Returned directly from <span className="text-zinc-300">/decompose</span>
        </p>
      </div>

      {/* Section 4: Hedge selection */}
      <div className="mt-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Hedge
        </p>
        <div className="flex flex-wrap gap-2">
          {HEDGEABLE.map((k) => {
            const on = hedged.has(k);
            return (
              <span
                key={k}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
                  on
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                    : "border-white/10 bg-white/[0.02] text-zinc-500"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: RIGHT_LAYER_COLORS[k] }}
                />
                {LAYER_LABEL[k]}
                <span className="ml-1 text-[10px] uppercase tracking-wider">
                  {on ? "on" : "off"}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Section 5: Remaining exposure */}
      <div className="mt-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400/80">
          Remaining exposure
        </p>
        <DecompositionBar shares={remainingShares} sigma={sigmaNaive} colors={RIGHT_LAYER_COLORS} muted />
        <DecompositionLegend shares={remainingShares} sigma={sigmaNaive} colors={RIGHT_LAYER_COLORS} />
        <p className="mt-3 text-sm leading-relaxed text-zinc-200">
          What&rsquo;s left is your actual position.
        </p>
      </div>
    </div>
  );
}

function DecompositionBar({
  shares,
  sigma,
  muted,
  colors = LAYER_COLORS,
}: {
  shares: Record<LayerKey, number>;
  sigma: number;
  muted?: boolean;
  colors?: Record<LayerKey, string>;
}) {
  const W = 360;
  const H = 36;
  const ML = 0;
  const MR = 0;
  const MT = 4;
  const MB = 4;
  const innerW = W - ML - MR;
  const innerH = H - MT - MB;

  // Total visible width is proportional to the share sum. For the full-stack
  // case (all layers present) the bar fills the panel; for the remaining bar
  // (some layers hedged out) the bar shortens proportionally.
  const totalShare = LAYER_ORDER.reduce((s, k) => s + shares[k], 0);
  const barW = innerW * totalShare;
  const sigmaPct = sigma * 100;
  const remainingSigmaPct = sigmaPct * totalShare;

  let cursor = ML;
  const segments: { key: LayerKey; x: number; w: number }[] = [];
  for (const k of LAYER_ORDER) {
    const w = innerW * shares[k];
    if (w > 0) segments.push({ key: k, x: cursor, w });
    cursor += w;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full"
      role="img"
    >
      <rect
        x={ML}
        y={MT}
        width={innerW}
        height={innerH}
        rx={3}
        ry={3}
        fill="#0c0c0e"
        stroke="#1f2937"
        strokeWidth={0.5}
      />
      {segments.map((s) => (
        <rect
          key={s.key}
          x={s.x}
          y={MT}
          width={s.w}
          height={innerH}
          fill={colors[s.key]}
          opacity={muted ? 0.85 : 1}
        >
          <title>
            {LAYER_LABEL[s.key]}: {(shares[s.key] * sigmaPct).toFixed(1)}% σ
          </title>
        </rect>
      ))}
      {/* End-of-bar σ label */}
      <text
        x={ML + barW + 6}
        y={MT + innerH / 2}
        dominantBaseline="middle"
        fontSize={11}
        fill="#e4e4e7"
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {remainingSigmaPct.toFixed(1)}% σ
      </text>
    </svg>
  );
}

function DecompositionLegend({
  shares,
  sigma,
  colors = LAYER_COLORS,
}: {
  shares: Record<LayerKey, number>;
  sigma: number;
  colors?: Record<LayerKey, string>;
}) {
  const sigmaPct = sigma * 100;
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-400 sm:grid-cols-4">
      {LAYER_ORDER.map((k) => {
        const v = shares[k] * sigmaPct;
        return (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: colors[k] }}
            />
            <span className="text-zinc-300">{LAYER_LABEL[k]}</span>
            <span className="ml-auto font-mono text-zinc-400">{v.toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

function absUsd(n: number): string {
  return Math.abs(n).toLocaleString("en-US");
}

function usdNotional(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

/** Round up to the nearest 5 percentage points (e.g. 0.529 → 0.55). */
function niceCeil5(v: number): number {
  if (v <= 0) return 0.05;
  return Math.ceil(v / 0.05) * 0.05;
}
