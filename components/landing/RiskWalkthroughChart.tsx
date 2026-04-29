"use client";

import { useEffect, useMemo, useState } from "react";
import { JetBrains_Mono } from "next/font/google";
import { Pause, Play, Plus, X, ArrowRight, Code } from "lucide-react";
import { cn } from "@/lib/cn";

/** CRT / ticker terminal — only applied to the Attribution Tape panel below the charts */
const attributionTapeCrtFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

type Step = {
  id: number;
  title: string;
  subtitle: string;
  description: string;
};

type Series = {
  key:
    | "gross"
    | "marketHedged"
    | "sectorHedged"
    | "subsectorHedged"
    | "residual";
  label: string;
  color: string;
  dash?: string;
};

type LegendItem = Omit<Series, "key"> & {
  key: Series["key"] | "subsector";
};

type SignedAttributionColors = {
  gross: string;
  market: string;
  sector: string;
  subsector: string;
  residual: string;
};

export type RiskWalkthroughLinePoint = {
  date: string;
  gross: number;
  marketHedged: number;
  sectorHedged: number;
  subsectorHedged: number;
  residual: number;
};

export type RiskWalkthroughBar = {
  spy_pp: number;
  sec_pp: number;
  sub_pp: number;
  res_pp: number;
  gross_pp: number;
};

export type RiskWalkthroughSnapshot = {
  ticker: string;
  symbol: string;
  name: string | null;
  asOf: string;
  sectorEtf: string | null;
  subsectorEtf: string | null;
  bar: RiskWalkthroughBar;
  line: RiskWalkthroughLinePoint[];
};

type RiskWalkthroughChartProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  snapshots?: Record<string, RiskWalkthroughSnapshot> | null;
  defaultTicker?: string;
  tickers?: string[];
};

const STEPS: Step[] = [
  {
    id: 1,
    title: "Market",
    subtitle: "Strip market beta (SPY).",
    description:
      "The first hedge strips out the market regime that SPY explains.",
  },
  {
    id: 2,
    title: "Sector",
    subtitle: "Strip sector beta (XLK, etc).",
    description:
      "After market risk, the remaining swing is still driven by sector exposure such as XLK.",
  },
  {
    id: 3,
    title: "Sub-sector",
    subtitle: "Strip sub-sector beta.",
    description:
      "A narrower sleeve like semis can still explain a meaningful share of the position.",
  },
  {
    id: 4,
    title: "Residual",
    subtitle: "What's left: stock-specific.",
    description:
      "After hedging market, sector, and sub-sector, the residual is the cleanest proxy for alpha.",
  },
];

const SIGNED_ATTRIBUTION_PALETTE = {
  gross: "#94A3B8",
  market: { up: "#F59E0B", down: "#B45309" },
  sector: { up: "#22C55E", down: "#166534" },
  subsector: { up: "#8B5CF6", down: "#5B21B6" },
  residual: { up: "#10B981", down: "#EF4444" },
};

/** How long each peel step stays on screen during auto-play (ms). */
const AUTO_STEP_INTERVAL_MS = 3200;
const AUTO_STEP_COUNT = 5;
const WATERFALL_STEP_COUNT = 4;

const MAG7_DEFAULT: string[] = [
  "AAPL",
  "MSFT",
  "NVDA",
  "GOOG",
  "AMZN",
  "META",
  "TSLA",
];

function signedColor(up: string, down: string, value: number): string {
  return value >= 0 ? up : down;
}

function buildSignedAttributionColors(
  bar: RiskWalkthroughBar,
): SignedAttributionColors {
  return {
    gross: SIGNED_ATTRIBUTION_PALETTE.gross,
    market: signedColor(
      SIGNED_ATTRIBUTION_PALETTE.market.up,
      SIGNED_ATTRIBUTION_PALETTE.market.down,
      bar.spy_pp,
    ),
    sector: signedColor(
      SIGNED_ATTRIBUTION_PALETTE.sector.up,
      SIGNED_ATTRIBUTION_PALETTE.sector.down,
      bar.sec_pp,
    ),
    subsector: signedColor(
      SIGNED_ATTRIBUTION_PALETTE.subsector.up,
      SIGNED_ATTRIBUTION_PALETTE.subsector.down,
      bar.sub_pp,
    ),
    residual: signedColor(
      SIGNED_ATTRIBUTION_PALETTE.residual.up,
      SIGNED_ATTRIBUTION_PALETTE.residual.down,
      bar.res_pp,
    ),
  };
}

function seriesWithSignedColors(colors: SignedAttributionColors): Series[] {
  return [
    { key: "marketHedged", label: "Market", color: colors.market },
    { key: "sectorHedged", label: "Sector", color: colors.sector },
    { key: "subsectorHedged", label: "Subsector", color: colors.subsector },
    { key: "residual", label: "L3 residual", color: colors.residual },
    { key: "gross", label: "Gross", color: colors.gross, dash: "6 4" },
  ];
}

function legendItemsWithSignedColors(
  colors: SignedAttributionColors,
): LegendItem[] {
  return [
    { key: "marketHedged", label: "Market", color: colors.market },
    { key: "sectorHedged", label: "Sector", color: colors.sector },
    { key: "subsector", label: "Subsector", color: colors.subsector },
    { key: "residual", label: "L3 residual", color: colors.residual },
    { key: "gross", label: "Gross", color: colors.gross, dash: "6 4" },
  ];
}

// Fallback demo data (NVDA)
const DEMO_SNAPSHOT: RiskWalkthroughSnapshot = {
  ticker: "NVDA",
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  asOf: "2026-04-17",
  sectorEtf: "XLK",
  subsectorEtf: "SMH",
  bar: {
    spy_pp: 68.08,
    sec_pp: 11.9,
    sub_pp: 12.78,
    res_pp: -12.96,
    gross_pp: 79.8,
  },
  line: [
    {
      date: "2026-01-02",
      gross: 0,
      marketHedged: 0,
      sectorHedged: 0,
      subsectorHedged: 0,
      residual: 0,
    },
    {
      date: "2026-02-03",
      gross: 18,
      marketHedged: 9,
      sectorHedged: 5,
      subsectorHedged: 5,
      residual: -1,
    },
    {
      date: "2026-03-03",
      gross: 39,
      marketHedged: 26,
      sectorHedged: 9,
      subsectorHedged: 8,
      residual: -4,
    },
    {
      date: "2026-04-17",
      gross: 80,
      marketHedged: 68,
      sectorHedged: 12,
      subsectorHedged: 13,
      residual: -13,
    },
  ],
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDateTick(value: string): string {
  if (!value) return "";
  const iso = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (!iso) return value;
  const [, , mm] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  const idx = Number(mm) - 1;
  return MONTH_LABELS[idx] ?? value;
}

function monthKey(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (match) return `${match[1]}-${match[2]}`;
  return value;
}

function buildLineYAxis(points: RiskWalkthroughLinePoint[]): {
  min: number;
  max: number;
  ticks: number[];
} {
  const values = points
    .flatMap((point) => [
      point.gross,
      point.marketHedged,
      point.sectorHedged,
      point.subsectorHedged,
      point.residual,
    ])
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return { min: -10, max: 10, ticks: [-10, -5, 0, 5, 10] };
  }

  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const roughRange = rawMax - rawMin;
  const tickStep = roughRange <= 35 ? 5 : roughRange <= 80 ? 10 : 20;
  const min = Math.floor(rawMin / tickStep) * tickStep;
  const max = Math.max(tickStep, Math.ceil(rawMax / tickStep) * tickStep);
  const ticks: number[] = [];
  for (let tick = min; tick <= max; tick += tickStep) ticks.push(tick);
  return { min, max, ticks };
}

function lineValue(
  point: RiskWalkthroughLinePoint,
  key: Series["key"],
): number {
  return point[key];
}

function svgPathForSeries({
  points,
  series,
  x,
  y,
}: {
  points: RiskWalkthroughLinePoint[];
  series: Series;
  x: (idx: number) => number;
  y: (value: number) => number;
}): string {
  return points
    .map(
      (point, idx) =>
        `${idx === 0 ? "M" : "L"} ${x(idx).toFixed(2)} ${y(lineValue(point, series.key)).toFixed(2)}`,
    )
    .join(" ");
}

/** Primary CTA banner for user conversion */
function AttributionTape({ cta }: { cta: string }) {
  return (
    <a
      href="/get-key"
      className={cn(
        attributionTapeCrtFont.className,
        "group block w-full rounded-lg border border-[#FFCC00] bg-[#04111d] px-4 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-10px_30px_rgba(255,204,0,0.04),0_0_18px_rgba(255,204,0,0.22)] transition hover:border-[#FFE066] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-10px_30px_rgba(255,204,0,0.07),0_0_26px_rgba(255,204,0,0.34)] focus:outline-none focus:ring-2 focus:ring-[#FFCC00]/60",
      )}
      aria-label="Get API key to access this data"
    >
      <span className="block text-[18px] font-bold uppercase leading-snug tracking-[0.07em] text-[#FFCC00] md:text-[22px] md:tracking-[0.09em]">
        {cta}
      </span>
    </a>
  );
}

/** Secondary developer/API CTA */
function DeveloperCta() {
  return (
    <a
      href="/quickstart"
      className="group mt-3 flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
    >
      <Code className="h-4 w-4" />
      Use this in your app or agent
      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
    </a>
  );
}

function LineAttributionChart({
  points,
  visibleSeries,
  yAxis,
  currentStep,
  grossValue,
  showGrossGuide,
}: {
  points: RiskWalkthroughLinePoint[];
  visibleSeries: Series[];
  yAxis: { min: number; max: number; ticks: number[] };
  currentStep: number;
  grossValue: number;
  showGrossGuide: boolean;
}) {
  const W = 588;
  const H = 350;
  const M = { top: 20, right: 12, bottom: 24, left: 44 };
  const innerW = W - M.left - M.right;
  const labelSlotW = innerW * 0.11;
  const dataW = innerW - labelSlotW;
  const innerH = H - M.top - M.bottom;
  const x = (idx: number) =>
    M.left + (points.length <= 1 ? 0 : (idx / (points.length - 1)) * dataW);
  const y = (value: number) =>
    M.top + innerH - ((value - yAxis.min) / (yAxis.max - yAxis.min)) * innerH;
  const zeroY = y(0);
  const lastGrossValue = points[points.length - 1]?.gross ?? grossValue;
  const grossY = y(lastGrossValue);
  const dataEndX = x(Math.max(0, points.length - 1));
  const grossLabelX = dataEndX + 10;
  const grossLabelY = Math.min(H - M.bottom - 18, Math.max(12, grossY - 7));
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));
  const monthStartIndexes = points.reduce<number[]>((indexes, point, idx) => {
    if (
      idx === 0 ||
      monthKey(point.date) !== monthKey(points[idx - 1]?.date ?? "")
    ) {
      indexes.push(idx);
    }
    return indexes;
  }, []);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative return attribution lines"
    >
      <line
        x1={M.left}
        x2={M.left}
        y1={0}
        y2={H - M.bottom}
        stroke="rgba(148,163,184,0.55)"
        strokeWidth={1.5}
      />
      {yAxis.ticks.map((tick) => (
        <g key={`line-y-${tick}`}>
          <line
            x1={M.left}
            x2={tick === 0 ? dataEndX : W - M.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={
              tick === 0 ? "rgba(148,163,184,0.68)" : "rgba(148,163,184,0.24)"
            }
            strokeDasharray={tick === 0 ? "0" : "3 3"}
            strokeWidth={tick === 0 ? 1.8 : 1.1}
          />
          <text
            x={M.left - 8}
            y={y(tick) + 4}
            fontSize="12"
            fill="#94A3B8"
            textAnchor="end"
          >
            {tick}%
          </text>
        </g>
      ))}
      <line
        x1={M.left}
        x2={dataEndX}
        y1={H - M.bottom}
        y2={H - M.bottom}
        stroke="rgba(148,163,184,0.65)"
        strokeWidth={2}
      />
      {monthStartIndexes.map((idx) => (
        <line
          key={`line-month-tick-${points[idx]?.date ?? idx}`}
          x1={x(idx)}
          x2={x(idx)}
          y1={H - M.bottom}
          y2={H - M.bottom + 5}
          stroke="rgba(203,213,225,0.8)"
          strokeWidth={1.4}
        />
      ))}
      {points.map((point, idx) => {
        if (idx % tickEvery !== 0 && idx !== points.length - 1) return null;
        return (
          <text
            key={`line-x-${point.date}-${idx}`}
            x={x(idx)}
            y={H - M.bottom + 20}
            fontSize="12"
            fill="#94A3B8"
            textAnchor="middle"
          >
            {formatDateTick(point.date)}
          </text>
        );
      })}
      {visibleSeries.map((series) => (
        <path
          key={series.key}
          d={svgPathForSeries({ points, series, x, y })}
          fill="none"
          stroke={series.color}
          strokeWidth={series.key === "gross" ? 2.5 : 3}
          strokeOpacity={
            currentStep >= 4 &&
            (series.key === "marketHedged" ||
              series.key === "sectorHedged" ||
              series.key === "subsectorHedged")
              ? 0.6
              : 1
          }
          strokeDasharray={series.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {showGrossGuide ? (
        <g>
          <line
            x1={M.left}
            x2={dataEndX}
            y1={grossY}
            y2={grossY}
            stroke="rgba(203,213,225,0.55)"
            strokeDasharray="3 3"
            strokeWidth={1.2}
          />
          <text
            x={grossLabelX}
            y={grossLabelY}
            fontSize="11"
            textAnchor="start"
            stroke="#020617"
            strokeWidth={3}
            paintOrder="stroke fill"
          >
            <tspan x={grossLabelX} fill="#CBD5E1" fontWeight={600}>
              Gross
            </tspan>
            <tspan x={grossLabelX} dy="12" fill="#F8FAFC" fontWeight={700}>
              {lastGrossValue > 0 ? "+" : ""}
              {lastGrossValue.toFixed(1)}%
            </tspan>
          </text>
        </g>
      ) : null}
      <circle cx={M.left} cy={zeroY} r={0.01} fill="transparent" />
    </svg>
  );
}

type WaterfallStep = {
  key: "gross" | "spy" | "sector" | "subsector" | "residual";
  label: string;
  value: number;
  start: number;
  end: number;
  color: string;
  isTotal?: boolean;
};

function buildWaterfallSteps(
  bar: RiskWalkthroughBar,
  sectorEtf: string | null,
  subsectorEtf: string | null,
  colors: SignedAttributionColors,
): WaterfallStep[] {
  const c1 = bar.spy_pp;
  const c2 = c1 + bar.sec_pp;
  const c3 = c2 + bar.sub_pp;
  const c4 = c3 + bar.res_pp;
  return [
    {
      key: "spy",
      label: "SPY",
      value: bar.spy_pp,
      start: 0,
      end: c1,
      color: colors.market,
    },
    {
      key: "sector",
      label: sectorEtf ?? "Sector",
      value: bar.sec_pp,
      start: c1,
      end: c2,
      color: colors.sector,
    },
    {
      key: "subsector",
      label: subsectorEtf ?? "Sub-sector",
      value: bar.sub_pp,
      start: c2,
      end: c3,
      color: colors.subsector,
    },
    {
      key: "residual",
      label: "Residual",
      value: bar.res_pp,
      start: c3,
      end: c4,
      color: colors.residual,
    },
    {
      key: "gross",
      label: "Gross",
      value: bar.gross_pp,
      start: 0,
      end: bar.gross_pp,
      color: colors.gross,
      isTotal: true,
    },
  ];
}

function WaterfallChart({
  steps,
  visibleThrough,
  showGrossGuide,
}: {
  steps: WaterfallStep[];
  visibleThrough: number;
  showGrossGuide: boolean;
}) {
  const W = 270;
  const H = 350;
  const M = { top: 20, right: 12, bottom: 24, left: 44 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const n = steps.length;
  const bandW = innerW / n;
  const barW = Math.min(52, bandW * 0.58);

  let yMin = 0;
  let yMax = 0;
  for (const s of steps) {
    yMin = Math.min(yMin, s.start, s.end);
    yMax = Math.max(yMax, s.start, s.end);
  }
  const roughRange = yMax - yMin;
  const tickStep = roughRange <= 25 ? 5 : roughRange <= 60 ? 10 : 20;
  yMin = yMin < 0 ? Math.floor(yMin / tickStep) * tickStep : 0;
  yMax = Math.max(tickStep, Math.ceil(yMax / tickStep) * tickStep);
  const y = (v: number) =>
    M.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const zeroY = y(0);

  const tickStart = Math.ceil(yMin / tickStep) * tickStep;
  const ticks: number[] = [];
  for (let t = tickStart; t <= yMax; t += tickStep) ticks.push(t);
  const gross = steps.find((s) => s.isTotal);
  const grossIndex = steps.findIndex((s) => s.isTotal);
  const grossCx =
    grossIndex >= 0 ? M.left + bandW * grossIndex + bandW / 2 : W - M.right;
  const residualIndex = steps.findIndex((s) => s.key === "residual");
  const residualCx =
    residualIndex >= 0
      ? M.left + bandW * residualIndex + bandW / 2
      : W - M.right;
  const residualFarEdge = residualCx + barW / 2;
  const grossY = y(gross?.value ?? steps[steps.length - 1]?.end ?? 0);
  const grossLabelX = grossCx;
  const grossLabelY = Math.min(H - M.bottom - 7, Math.max(12, grossY - 7));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      role="img"
      aria-label="Return attribution waterfall"
    >
      <line
        x1={M.left}
        x2={M.left}
        y1={0}
        y2={H - M.bottom}
        stroke="rgba(148,163,184,0.55)"
        strokeWidth={1.5}
      />

      {ticks.map((t) => (
        <g key={`tick-${t}`}>
          <line
            x1={M.left}
            x2={t === 0 ? residualFarEdge : W - M.right}
            y1={y(t)}
            y2={y(t)}
            stroke={
              t === 0 ? "rgba(148,163,184,0.65)" : "rgba(148,163,184,0.24)"
            }
            strokeDasharray={t === 0 ? "0" : "3 3"}
            strokeWidth={t === 0 ? 2 : 1.2}
          />
          <text
            x={M.left - 8}
            y={y(t) + 4}
            fontSize="11"
            fill="#94A3B8"
            textAnchor="end"
          >
            {t}%
          </text>
        </g>
      ))}

      {gross && showGrossGuide ? (
        <g>
          <line
            x1={M.left}
            x2={grossCx}
            y1={grossY}
            y2={grossY}
            stroke="rgba(203,213,225,0.55)"
            strokeDasharray="3 3"
            strokeWidth={1.2}
          />
          <text
            x={grossLabelX}
            y={grossLabelY}
            fontSize="10"
            textAnchor="middle"
            stroke="#020617"
            strokeWidth={3}
            paintOrder="stroke fill"
          >
            <tspan x={grossLabelX} fill="#CBD5E1" fontWeight={600}>
              Gross
            </tspan>
            <tspan x={grossLabelX} dy="11" fill="#F8FAFC" fontWeight={700}>
              {gross.value > 0 ? "+" : ""}
              {gross.value.toFixed(1)}%
            </tspan>
          </text>
        </g>
      ) : null}

      {steps.map((s, i) => {
        const cx = M.left + bandW * i + bandW / 2;
        const x = cx - barW / 2;
        const top = y(Math.max(s.start, s.end));
        const bottom = y(Math.min(s.start, s.end));
        const h = Math.max(2, bottom - top);
        const faded = s.isTotal ? visibleThrough < 4 : i >= visibleThrough;
        const fill = s.color;
        const opacity = faded ? 0.12 : 1;
        const prev = i > 0 ? steps[i - 1] : null;
        const prevCx = M.left + bandW * (i - 1) + bandW / 2;
        const prevEndX = prev ? prevCx + barW / 2 : 0;
        const thisStartX = cx - barW / 2;
        const connectorY = prev ? y(prev.end) : null;

        if (s.isTotal) {
          return (
            <g key={s.key} opacity={opacity}>
              {prev && connectorY != null ? (
                <line
                  x1={prevEndX}
                  y1={connectorY}
                  x2={grossCx}
                  y2={grossY}
                  stroke="rgba(148,163,184,0.45)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              ) : null}
            </g>
          );
        }

        return (
          <g key={s.key} opacity={opacity}>
            {prev && connectorY != null && (
              <line
                x1={prevEndX}
                y1={connectorY}
                x2={thisStartX}
                y2={connectorY}
                stroke="rgba(148,163,184,0.6)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
            <rect x={x} y={top} width={barW} height={h} fill={fill} rx={3} />
            <text
              x={cx}
              y={s.value < 0 ? bottom + 14 : top - 6}
              fontSize="11"
              fontWeight={600}
              fill={s.value < 0 ? "#F87171" : "#F8FAFC"}
              textAnchor="middle"
            >
              {s.value > 0 ? "+" : ""}
              {s.value.toFixed(1)}%
            </text>
            <line
              x1={cx}
              x2={cx}
              y1={H - M.bottom}
              y2={H - M.bottom + 5}
              stroke="rgba(203,213,225,0.8)"
              strokeWidth={1.3}
            />
            <text
              x={cx}
              y={H - M.bottom + 20}
              fontSize="11"
              fill="#CBD5E1"
              textAnchor="middle"
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function RiskWalkthroughChart({
  eyebrow = "Example",
  title = "Stock Return Attribution YTD",
  description,
  snapshots = null,
  defaultTicker = "NVDA",
  tickers,
}: RiskWalkthroughChartProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [waterfallVisibleThrough, setWaterfallVisibleThrough] = useState(0);
  const [tourPaused, setTourPaused] = useState(false);

  const [customSnapshots, setCustomSnapshots] = useState<
    Record<string, RiskWalkthroughSnapshot>
  >({});
  const [customInputOpen, setCustomInputOpen] = useState(false);
  const [customInputValue, setCustomInputValue] = useState("");
  const [customLoading, setCustomLoading] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  const baseTickers = useMemo(() => {
    if (tickers && tickers.length) return tickers;
    if (snapshots) return Object.keys(snapshots);
    return MAG7_DEFAULT;
  }, [snapshots, tickers]);

  const customTickers = useMemo(
    () => Object.keys(customSnapshots),
    [customSnapshots],
  );

  const pickerTickers = useMemo(() => {
    const merged = [
      ...baseTickers,
      ...customTickers.filter((t) => !baseTickers.includes(t)),
    ];
    return merged.length > 0 ? merged : MAG7_DEFAULT;
  }, [baseTickers, customTickers]);

  const initialTicker = snapshots?.[defaultTicker]
    ? defaultTicker
    : (pickerTickers[0] ?? defaultTicker);

  const [selectedTicker, setSelectedTicker] = useState(initialTicker);
  const selected =
    customSnapshots[selectedTicker] ??
    snapshots?.[selectedTicker] ??
    snapshots?.[defaultTicker] ??
    DEMO_SNAPSHOT;

  const activeBar = selected.bar;
  const activeLine = selected.line;

  const factorLiftPct = activeBar.spy_pp + activeBar.sec_pp + activeBar.sub_pp;
  const residualLabel =
    activeBar.res_pp < 0 ? "RESIDUAL DRAG" : "RESIDUAL LIFT";
  const attributionCta = `EXPLAIN YOUR PORTFOLIO → ${selected.ticker ?? selectedTicker} ${activeBar.gross_pp >= 0 ? "+" : ""}${activeBar.gross_pp.toFixed(1)}% YTD • ${factorLiftPct >= 0 ? "+" : ""}${factorLiftPct.toFixed(1)}% BETA LIFT • ${activeBar.res_pp >= 0 ? "+" : ""}${activeBar.res_pp.toFixed(1)}% ${residualLabel}`;

  const signedColors = useMemo(
    () => buildSignedAttributionColors(activeBar),
    [activeBar],
  );
  const lineSeries = useMemo(
    () => seriesWithSignedColors(signedColors),
    [signedColors],
  );
  const legendItems = useMemo(
    () => legendItemsWithSignedColors(signedColors),
    [signedColors],
  );
  const waterfallSteps = useMemo(
    () =>
      buildWaterfallSteps(
        activeBar,
        selected.sectorEtf,
        selected.subsectorEtf,
        signedColors,
      ),
    [activeBar, selected.sectorEtf, selected.subsectorEtf, signedColors],
  );

  const visibleLineSeries = useMemo(
    () => lineSeries.slice(0, currentStep),
    [lineSeries, currentStep],
  );
  const lineYAxis = useMemo(() => buildLineYAxis(activeLine), [activeLine]);

  const hasLineData = activeLine.length > 0;
  const cycleComplete =
    hasLineData &&
    currentStep >= AUTO_STEP_COUNT &&
    waterfallVisibleThrough >= WATERFALL_STEP_COUNT;
  const showResume = tourPaused || cycleComplete;

  useEffect(() => {
    setCurrentStep(1);
    setWaterfallVisibleThrough(0);
    setTourPaused(false);
  }, [selectedTicker]);

  useEffect(() => {
    if (!hasLineData) return;
    const nextVisibleThrough = Math.min(currentStep, WATERFALL_STEP_COUNT);
    if (currentStep > WATERFALL_STEP_COUNT) {
      setWaterfallVisibleThrough(WATERFALL_STEP_COUNT);
      return;
    }
    setWaterfallVisibleThrough((prev) =>
      Math.min(prev, Math.max(0, nextVisibleThrough - 1)),
    );
    const id = window.setTimeout(() => {
      setWaterfallVisibleThrough(nextVisibleThrough);
    }, 900);
    return () => window.clearTimeout(id);
  }, [currentStep, hasLineData]);

  useEffect(() => {
    if (tourPaused || !hasLineData) return;
    if (currentStep >= AUTO_STEP_COUNT) return;
    const id = window.setTimeout(() => {
      setCurrentStep((s) => Math.min(AUTO_STEP_COUNT, s + 1));
    }, AUTO_STEP_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [tourPaused, hasLineData, currentStep]);

  function selectTicker(t: string, source: "mag7" | "custom"): void {
    setSelectedTicker(t);
  }

  function openCustomInput(): void {
    setCustomError(null);
    setCustomInputOpen(true);
  }

  function cancelCustomInput(): void {
    setCustomInputOpen(false);
    setCustomInputValue("");
    setCustomError(null);
  }

  function toggleTourPlayback(): void {
    if (showResume) {
      if (cycleComplete) {
        setCurrentStep(1);
        setWaterfallVisibleThrough(0);
      }
      setTourPaused(false);
      return;
    }
    setTourPaused(true);
  }

  async function submitCustomTicker(): Promise<void> {
    const raw = customInputValue.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw)) {
      setCustomError("Enter a valid US equity ticker (e.g. AAPL).");
      return;
    }
    setCustomError(null);
    setCustomLoading(raw);
    try {
      const res = await fetch(
        `/api/landing/walkthrough-chart?ticker=${encodeURIComponent(raw)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        setCustomError(
          res.status === 404
            ? `Couldn't find ${raw}.`
            : "Something went wrong. Try again.",
        );
        return;
      }
      const json = (await res.json()) as {
        ticker: string;
        snapshot: RiskWalkthroughSnapshot;
      };
      const snap = json.snapshot;
      if (!snap) {
        setCustomError(`No data found for ${raw}.`);
        return;
      }
      setCustomSnapshots((prev) => ({ ...prev, [raw]: snap }));
      setSelectedTicker(raw);
      setCustomInputOpen(false);
      setCustomInputValue("");
    } catch (e) {
      setCustomError("Network error. Try again.");
    } finally {
      setCustomLoading(null);
    }
  }

  return (
    <section
      className="w-full bg-zinc-950 py-4 md:py-5"
      aria-label="Risk walkthrough"
    >
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 lg:px-12">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-sm md:rounded-2xl md:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                {eyebrow}
              </div>
              <h2 className="text-xl font-semibold text-white md:text-2xl">
                {selected.ticker ?? selectedTicker} {title}
              </h2>
            </div>
            {hasLineData ? (
              <div className="flex items-center justify-start gap-2 sm:justify-end">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  {cycleComplete
                    ? "Complete"
                    : tourPaused
                      ? "Paused"
                      : "Auto-cycling"}{" "}
                  · {currentStep} / {AUTO_STEP_COUNT}
                </span>
                <button
                  type="button"
                  onClick={toggleTourPlayback}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  {showResume ? (
                    <>
                      <Play className="h-3 w-3" aria-hidden />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3" aria-hidden />
                      Pause
                    </>
                  )}
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-1 grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-3">
            <div className="flex flex-col gap-1.5">
              <div
                className={cn(
                  "flex flex-wrap items-center gap-1.5",
                  customError ? "mb-0" : "mb-1.5",
                )}
              >
                {pickerTickers.map((t) => {
                  const isActive = t === selectedTicker;
                  const isCustom = !!customSnapshots[t];
                  const hasData = isCustom || !!snapshots?.[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        hasData && selectTicker(t, isCustom ? "custom" : "mag7")
                      }
                      disabled={!hasData}
                      aria-pressed={isActive}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition",
                        isActive
                          ? "bg-cyan-500 text-white shadow-sm"
                          : hasData
                            ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                            : "cursor-not-allowed bg-zinc-900 text-zinc-600",
                      )}
                    >
                      {t}
                    </button>
                  );
                })}

                {customInputOpen ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitCustomTicker();
                    }}
                    className="flex flex-wrap items-center gap-1"
                  >
                    <input
                      type="text"
                      autoFocus
                      inputMode="text"
                      maxLength={10}
                      value={customInputValue}
                      onChange={(e) =>
                        setCustomInputValue(e.target.value.toUpperCase())
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelCustomInput();
                        }
                      }}
                      placeholder="TICKER"
                      aria-label="Enter a ticker"
                      disabled={!!customLoading}
                      className="w-20 rounded-md border border-cyan-500 bg-zinc-900 px-2 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-white placeholder:text-zinc-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={!!customLoading || !customInputValue.trim()}
                      className="rounded-md bg-cyan-500 px-2 py-1 font-mono text-xs font-semibold text-white shadow-sm transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Run snapshot for typed ticker"
                    >
                      {customLoading ? "…" : "Enter"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelCustomInput}
                      disabled={!!customLoading}
                      aria-label="Cancel"
                      className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={openCustomInput}
                    className="flex animate-pulse items-center gap-1 rounded-md border border-dashed border-cyan-500 bg-cyan-950/30 px-2.5 py-1 font-mono text-xs font-semibold text-cyan-300 shadow-[0_0_0_2px_rgba(6,182,212,0.18)] transition hover:animate-none hover:border-cyan-400 hover:bg-cyan-900/40 hover:text-cyan-200"
                    aria-label="Enter ticker"
                  >
                    <Plus className="h-3 w-3" />
                    Enter Ticker
                  </button>
                )}
              </div>
              {customError && (
                <div className="mb-1.5 text-xs text-rose-400" role="alert">
                  {customError}
                </div>
              )}

              {STEPS.map((item) => {
                const activeStep = Math.min(currentStep, WATERFALL_STEP_COUNT);
                const on = activeStep === item.id;
                const done = activeStep > item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTourPaused(true);
                      setCurrentStep(item.id);
                    }}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition",
                      on
                        ? "border-cyan-500 bg-cyan-950/30 ring-1 ring-cyan-500/30"
                        : "border-zinc-700 hover:border-zinc-600",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        on
                          ? "bg-cyan-500 text-white"
                          : done
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-800 text-zinc-500",
                      )}
                    >
                      {item.id}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-xs leading-snug text-zinc-400">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}

              {snapshots?.[selectedTicker] && (
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-400">
                  2Y view when live data
                </span>
              )}
            </div>

            <div>
              <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(248px,0.82fr)] lg:gap-2">
                <div className="h-[280px] sm:h-[320px] md:h-[350px]">
                  <LineAttributionChart
                    points={activeLine}
                    visibleSeries={visibleLineSeries}
                    yAxis={lineYAxis}
                    currentStep={currentStep}
                    grossValue={activeBar.gross_pp}
                    showGrossGuide={cycleComplete}
                  />
                </div>

                <div className="h-[280px] sm:h-[320px] md:h-[350px]">
                  <WaterfallChart
                    steps={waterfallSteps}
                    visibleThrough={waterfallVisibleThrough}
                    showGrossGuide={cycleComplete}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-xs text-zinc-400">
                {legendItems.map((series) => {
                  const dim =
                    (series.key === "residual" && currentStep < 4) ||
                    (currentStep >= 4 &&
                      (series.key === "marketHedged" ||
                        series.key === "sectorHedged" ||
                        series.key === "subsector"));
                  return (
                    <div
                      key={series.key}
                      className={cn(
                        "flex items-center gap-2 transition-opacity",
                        dim ? "opacity-35" : "opacity-100",
                      )}
                    >
                      <span
                        className="h-2.5 w-7 shrink-0 rounded-full"
                        style={{
                          backgroundColor: series.color,
                          opacity: series.key === "gross" ? 0.85 : 1,
                          backgroundImage: series.dash
                            ? `repeating-linear-gradient(90deg, ${series.color} 0 4px, transparent 4px 8px)`
                            : undefined,
                        }}
                      />
                      <span>{series.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-zinc-800 pt-3">
            <AttributionTape cta={attributionCta} />
            <DeveloperCta />
          </div>
        </div>
      </div>
    </section>
  );
}
