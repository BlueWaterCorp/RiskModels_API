"use client";

import { useEffect, useMemo, useState } from "react";
import { ATTRIBUTION_HEX } from "@/lib/landing/attributionColors";

/**
 * Portfolio concentration / diversification — Chart 2 of the landing page.
 *
 * LEFT panel: Marimekko of MAG7. Each ticker is a horizontal bar. Bar
 * thickness ∝ market-cap weight. Bar length is fixed at 100% and stacked
 * by L3 variance share (market / sector / subsector / residual).
 *
 * RIGHT panel: two vertical bars. Equal-weight portfolio vs cap-weight
 * portfolio. Each bar shows the naive position-weighted variance stack
 * with an "adjusted" line marking post-correlation portfolio risk; the
 * shaded delta is "X% of your risk is redundant."
 *
 * All values come from /api/landing/concentration.
 */

const LAYER_COLORS = {
  market: ATTRIBUTION_HEX.market.up,
  sector: ATTRIBUTION_HEX.sector.up,
  subsector: ATTRIBUTION_HEX.subsector.up,
  residual: ATTRIBUTION_HEX.residual.up,
} as const;

const LAYER_ORDER = ["market", "sector", "subsector", "residual"] as const;
type LayerKey = (typeof LAYER_ORDER)[number];

const LAYER_LABEL: Record<LayerKey, string> = {
  market: "Market",
  sector: "Sector",
  subsector: "Subsector",
  residual: "Residual",
};

interface ConcentrationTicker {
  ticker: string;
  name: string | null;
  market_cap: number | null;
  l3_mkt_er: number;
  l3_sec_er: number;
  l3_sub_er: number;
  l3_res_er: number;
  total_er: number;
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
  redundancy_pct: number;
}

interface ConcentrationPayload {
  tickers: string[];
  per_ticker: Record<string, ConcentrationTicker>;
  portfolios: {
    equal_weight: PortfolioBlock;
    cap_weighted: PortfolioBlock | null;
  };
  data_as_of: string;
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
    <section className="border-b border-zinc-800/80 bg-zinc-950 px-4 pb-20 pt-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-3 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Portfolio risk
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            You&rsquo;re not diversified. You&rsquo;re concentrated.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Same stocks. Different weights. Completely different risk.
          </p>
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

        {data?.data_as_of && (
          <p className="mt-6 text-center text-[11px] uppercase tracking-wider text-zinc-600">
            Data as of {data.data_as_of}
          </p>
        )}
      </div>
    </section>
  );
}

// ── Chart body (post-fetch) ───────────────────────────────────────────────

function ChartBody({ data }: { data: ConcentrationPayload }) {
  const { tickers, per_ticker, portfolios } = data;

  // Sort tickers by cap weight desc for the Marimekko (largest cap on top).
  const capRows = useMemo(() => {
    const totalCap = tickers.reduce(
      (sum, t) => sum + (per_ticker[t]?.market_cap ?? 0),
      0,
    );
    if (totalCap <= 0) return [];
    return tickers
      .map((t) => {
        const row = per_ticker[t];
        const cap = row?.market_cap ?? 0;
        return {
          ticker: t,
          name: row?.name ?? null,
          capWeight: cap / totalCap,
          shares: normalizeShares(row),
        };
      })
      .filter((r) => r.capWeight > 0)
      .sort((a, b) => b.capWeight - a.capWeight);
  }, [tickers, per_ticker]);

  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:gap-8">
      <Marimekko rows={capRows} />
      <DualPortfolioPanel portfolios={portfolios} />
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

// ── Marimekko (left panel) ────────────────────────────────────────────────

interface CapRow {
  ticker: string;
  name: string | null;
  capWeight: number;
  shares: Record<LayerKey, number>;
}

function Marimekko({ rows }: { rows: CapRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-zinc-500">
        Cap weights unavailable.
      </div>
    );
  }

  // Internal coordinate system. The container scales the SVG, so these are
  // logical units only.
  const W = 720;
  const H = 480;
  const M = { top: 36, right: 24, bottom: 56, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const totalCapWeight = rows.reduce((s, r) => s + r.capWeight, 0) || 1;
  const gapPx = 6;
  const totalGap = gapPx * (rows.length - 1);
  const usableH = Math.max(0, innerH - totalGap);

  // Min bar height so smallest cap is still legible. Trade off: keep widths
  // representative of cap, but no row collapses to invisibility.
  const MIN_ROW_PX = 14;
  let drawn = 0;
  const heights: number[] = rows.map((r) => {
    const raw = (r.capWeight / totalCapWeight) * usableH;
    return Math.max(MIN_ROW_PX, raw);
  });
  const sumHeights = heights.reduce((a, b) => a + b, 0);
  if (sumHeights > usableH) {
    // Re-normalize after MIN_ROW_PX clamp pushed total over.
    const scale = usableH / sumHeights;
    for (let i = 0; i < heights.length; i++) heights[i] *= scale;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-6">
      <div className="mb-3">
        <h3 className="text-sm font-semibold tracking-tight text-white">
          Per-stock risk
        </h3>
        <p className="text-xs text-zinc-500">
          Bar thickness = market-cap weight. Stack = variance share.
        </p>
      </div>

      <div className="w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          role="img"
          aria-label="Per-stock risk Marimekko: bar thickness proportional to market cap, stack by L3 variance share"
        >
          {/* X-axis baseline */}
          <line
            x1={M.left}
            x2={M.left + innerW}
            y1={M.top + innerH + 0.5}
            y2={M.top + innerH + 0.5}
            stroke="#475569"
            strokeWidth={0.5}
          />

          {/* X-axis ticks: 0, 25, 50, 75, 100% */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const x = M.left + innerW * t;
            return (
              <g key={t}>
                <line
                  x1={x}
                  x2={x}
                  y1={M.top}
                  y2={M.top + innerH}
                  stroke="#1f2937"
                  strokeDasharray="2 4"
                  strokeWidth={0.5}
                />
                <text
                  x={x}
                  y={M.top + innerH + 18}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#71717a"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {Math.round(t * 100)}%
                </text>
              </g>
            );
          })}

          {/* Axis title */}
          <text
            x={M.left + innerW / 2}
            y={M.top + innerH + 38}
            textAnchor="middle"
            fontSize={11}
            fill="#a1a1aa"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            Variance share (market → residual)
          </text>

          {/* Bars */}
          {rows.map((row, i) => {
            const yStart =
              M.top +
              heights.slice(0, i).reduce((a, b) => a + b, 0) +
              gapPx * i;
            const h = heights[i];
            return (
              <MarimekkoRow
                key={row.ticker}
                row={row}
                x={M.left}
                y={yStart}
                w={innerW}
                h={h}
                axisX={M.left}
              />
            );
          })}
        </svg>
      </div>

      <Legend />
    </div>
  );
}

function MarimekkoRow({
  row,
  x,
  y,
  w,
  h,
  axisX,
}: {
  row: CapRow;
  x: number;
  y: number;
  w: number;
  h: number;
  axisX: number;
}) {
  const segments: { key: LayerKey; w: number; x: number }[] = [];
  let cursor = x;
  for (const key of LAYER_ORDER) {
    const segW = w * row.shares[key];
    segments.push({ key, w: segW, x: cursor });
    cursor += segW;
  }

  return (
    <g>
      {/* Ticker label */}
      <text
        x={axisX - 12}
        y={y + h / 2}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize={Math.min(13, Math.max(10, h * 0.55))}
        fill="#e4e4e7"
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {row.ticker}
      </text>
      <text
        x={axisX - 12}
        y={y + h / 2 + Math.min(13, Math.max(10, h * 0.55)) * 0.95}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize={9}
        fill="#71717a"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {(row.capWeight * 100).toFixed(1)}%
      </text>

      {/* Stacked segments */}
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
              {row.ticker} · {LAYER_LABEL[s.key]}: {(row.shares[s.key] * 100).toFixed(1)}%
            </title>
          </rect>
        ) : null,
      )}
    </g>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] text-zinc-400">
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

// ── Dual portfolio panel (right) ──────────────────────────────────────────

function DualPortfolioPanel({
  portfolios,
}: {
  portfolios: ConcentrationPayload["portfolios"];
}) {
  const equal = portfolios.equal_weight;
  const cap = portfolios.cap_weighted;

  if (!equal) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-zinc-500">
        Portfolio data unavailable.
      </div>
    );
  }

  const yMaxCandidate = Math.max(
    equal.naive.total,
    cap?.naive.total ?? 0,
  );
  const yMax = niceCeil(yMaxCandidate);

  // Coordinate system shared by both bars.
  const W = 380;
  const H = 480;
  const M = { top: 36, right: 16, bottom: 96, left: 56 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const portfolioCount = cap ? 2 : 1;
  const slotW = innerW / portfolioCount;
  const barW = Math.min(80, slotW * 0.55);

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-6">
      <div className="mb-3">
        <h3 className="text-sm font-semibold tracking-tight text-white">
          Portfolio risk
        </h3>
        <p className="text-xs text-zinc-500">
          Naive variance stack. Line = portfolio risk after correlation.
        </p>
      </div>

      <div className="w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          role="img"
          aria-label="Equal-weight vs cap-weighted portfolio variance with diversification adjustment"
        >
          {/* Y-axis ticks (5 evenly spaced) */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = M.top + innerH * (1 - t);
            return (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={M.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="#1f2937"
                  strokeDasharray="2 4"
                  strokeWidth={0.5}
                />
                <text
                  x={M.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="#71717a"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {(yMax * t * 100).toFixed(0)}%
                </text>
              </g>
            );
          })}

          {/* Y-axis title */}
          <text
            x={M.left - 44}
            y={M.top + innerH / 2}
            textAnchor="middle"
            fontSize={11}
            fill="#a1a1aa"
            transform={`rotate(-90 ${M.left - 44} ${M.top + innerH / 2})`}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            Explained variance
          </text>

          {/* Bars */}
          <PortfolioBar
            label="Equal weight"
            block={equal}
            yMax={yMax}
            x={M.left + slotW * 0.5 - barW / 2}
            barW={barW}
            top={M.top}
            innerH={innerH}
          />
          {cap && (
            <PortfolioBar
              label="Cap weighted"
              block={cap}
              yMax={yMax}
              x={M.left + slotW * 1.5 - barW / 2}
              barW={barW}
              top={M.top}
              innerH={innerH}
            />
          )}
        </svg>
      </div>

      <p className="mt-3 text-center text-[11px] uppercase tracking-wider text-zinc-500">
        Weighting changes your risk. It doesn&rsquo;t automatically diversify it.
      </p>
    </div>
  );
}

function PortfolioBar({
  label,
  block,
  yMax,
  x,
  barW,
  top,
  innerH,
}: {
  label: string;
  block: PortfolioBlock;
  yMax: number;
  x: number;
  barW: number;
  top: number;
  innerH: number;
}) {
  const naive = block.naive;
  const adjusted = block.adjusted;

  const yScale = (v: number) => top + innerH * (1 - v / yMax);

  // Stack from bottom (market) to top (residual)
  const segments: { key: LayerKey; value: number }[] = [
    { key: "market", value: naive.market_er },
    { key: "sector", value: naive.sector_er },
    { key: "subsector", value: naive.subsector_er },
    { key: "residual", value: naive.residual_er },
  ];

  let cumBottom = 0;
  const rects = segments.map((s) => {
    const yTop = yScale(cumBottom + s.value);
    const yBot = yScale(cumBottom);
    cumBottom += s.value;
    return { key: s.key, x, y: yTop, w: barW, h: Math.max(0, yBot - yTop) };
  });

  const naiveTopY = yScale(naive.total);
  const adjTopY = yScale(adjusted.total);
  const redundancyPct = block.redundancy_pct;

  return (
    <g>
      {/* Naive stacked segments */}
      {rects.map((r) =>
        r.h > 0.4 ? (
          <rect
            key={r.key}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill={LAYER_COLORS[r.key]}
          />
        ) : null,
      )}

      {/* Hatched overlay between naive top and adjusted top — the "redundant" band */}
      {adjTopY > naiveTopY && (
        <rect
          x={x}
          y={naiveTopY}
          width={barW}
          height={Math.max(0, adjTopY - naiveTopY)}
          fill="url(#redundantHatch)"
          opacity={0.55}
        />
      )}
      <RedundantHatchDef />

      {/* Adjusted line — after correlation, this is what risk you actually bear */}
      <line
        x1={x - 6}
        x2={x + barW + 6}
        y1={adjTopY}
        y2={adjTopY}
        stroke="#fbbf24"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={x + barW + 10}
        y={adjTopY}
        dominantBaseline="middle"
        fontSize={10}
        fill="#fbbf24"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Adjusted
      </text>

      {/* Naive total label above the bar */}
      <text
        x={x + barW / 2}
        y={naiveTopY - 8}
        textAnchor="middle"
        fontSize={11}
        fill="#e4e4e7"
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {(naive.total * 100).toFixed(0)}%
      </text>

      {/* Bar label and redundancy callout */}
      <text
        x={x + barW / 2}
        y={top + innerH + 18}
        textAnchor="middle"
        fontSize={11}
        fill="#e4e4e7"
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {label}
      </text>
      <text
        x={x + barW / 2}
        y={top + innerH + 36}
        textAnchor="middle"
        fontSize={11}
        fill="#fbbf24"
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {redundancyPct.toFixed(0)}% redundant
      </text>
      <text
        x={x + barW / 2}
        y={top + innerH + 50}
        textAnchor="middle"
        fontSize={9}
        fill="#71717a"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        of stated risk
      </text>
    </g>
  );
}

function RedundantHatchDef() {
  return (
    <defs>
      <pattern
        id="redundantHatch"
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="6" stroke="#fbbf24" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 0.1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  let nice: number;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}
