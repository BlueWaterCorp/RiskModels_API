/**
 * I. Cumulative Returns — 2-panel SVG chart for the F1 fund tearsheet.
 *
 * Mirrors the published RM_ORG/content/medium/series/Part_1/section_I
 * NVDA reference: a left line panel showing each L*-layer cumulative
 * path (L1 SPY · L2 sector · L3 subsector · L3 residual · gross fund),
 * tied via a curved connector to a right waterfall panel that decomposes
 * the gross endpoint into incremental layer contributions summing to gross.
 *
 * D.2 addition: a thicker green "Realized NAV" line (yfinance) overlays
 * the gross-fund line. Where the two diverge is the institutional-grade
 * insight — captures intra-quarter trading, fees, cash drag invisible
 * to 13F-derived attribution.
 *
 * Pure SVG, no charting library. Playwright renders this server-side via
 * the /render-snapshot/funds/[bw_fund_id] page route.
 */

import React from "react";

import { LAYER_COLORS, PALETTE } from "../_theme";
import type {
  AttributionWaterfall,
  CumulativeSeries,
} from "../cumulative-math";

// ─────────────────────────────────────────────────────────────────────
// Component contract
// ─────────────────────────────────────────────────────────────────────

interface CumulativeChartProps {
  series: CumulativeSeries;
  waterfall: AttributionWaterfall;
  /** Total chart width in px (left+right panels + gap). */
  width?: number;
  /** Total chart height in px. */
  height?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Small SVG primitives
// ─────────────────────────────────────────────────────────────────────

function fmtPct(x: number, signed = true): string {
  const v = x * 100;
  if (Math.abs(v) < 0.05) return "0.0%";
  return signed ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
}

function fmtMonthLabel(teo: string): string {
  // teo is YYYY-MM-DD → "MMM YY"
  const d = new Date(`${teo}T12:00:00Z`);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = String(d.getUTCFullYear()).slice(-2);
  return `${month} ${year}`;
}

// ─────────────────────────────────────────────────────────────────────
// Left panel: cumulative line chart
// ─────────────────────────────────────────────────────────────────────

interface LinePanelProps {
  series: CumulativeSeries;
  x: number;
  y: number;
  width: number;
  height: number;
  yMin: number;
  yMax: number;
}

function LinePanel({ series, x, y, width, height, yMin, yMax }: LinePanelProps) {
  if (series.teos.length === 0) {
    return (
      <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fontSize={12} fill={PALETTE.textMid}>
        No portfolio history available
      </text>
    );
  }

  const padL = 56;
  const padR = 60;
  const padT = 8;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = series.teos.length;

  const xAt = (i: number) => x + padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => y + padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const path = (vals: number[]): string =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(" ");

  // Y-axis ticks: 5 evenly-spaced grid lines.
  const ticks = 5;
  const yTicks = Array.from({ length: ticks }, (_, i) => yMin + ((yMax - yMin) * i) / (ticks - 1));

  const lines: { key: keyof CumulativeSeries; data: number[]; color: string; width: number; dasharray?: string }[] = [
    { key: "l1_market", data: series.l1_market, color: LAYER_COLORS.l1_market, width: 1.5, dasharray: "4 3" },
    { key: "l2_sector", data: series.l2_sector, color: LAYER_COLORS.l2_sector, width: 1.5, dasharray: "4 3" },
    { key: "l3_subsector", data: series.l3_subsector, color: LAYER_COLORS.l3_subsector, width: 1.5, dasharray: "4 3" },
    { key: "residual", data: series.residual, color: LAYER_COLORS.residual, width: 1.5 },
    { key: "gross", data: series.gross, color: LAYER_COLORS.gross, width: 2.4 },
  ];
  if (series.nav.length > 0) {
    lines.push({ key: "nav", data: series.nav, color: LAYER_COLORS.nav, width: 2.4 });
  }

  // X-axis labels: first, last, and ~3 evenly-spaced inside.
  const labelIdx = n <= 6 ? series.teos.map((_, i) => i) : [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];

  return (
    <g>
      {/* Y-grid */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={x + padL} x2={x + padL + innerW} y1={yAt(v)} y2={yAt(v)} stroke={PALETTE.axisLine} strokeWidth={0.5} />
          <text x={x + padL - 6} y={yAt(v) + 3} textAnchor="end" fontSize={9} fill={PALETTE.textMid}>
            {fmtPct(v, false)}
          </text>
        </g>
      ))}
      {/* Zero line emphasis */}
      <line x1={x + padL} x2={x + padL + innerW} y1={yAt(0)} y2={yAt(0)} stroke={PALETTE.textMid} strokeWidth={0.8} />

      {/* Cumulative paths */}
      {lines.map((l) => (
        <path
          key={l.key}
          d={path(l.data)}
          fill="none"
          stroke={l.color}
          strokeWidth={l.width}
          strokeDasharray={l.dasharray}
        />
      ))}

      {/* X-axis labels */}
      {labelIdx.map((i) => (
        <text key={i} x={xAt(i)} y={y + height - 8} textAnchor="middle" fontSize={9} fill={PALETTE.textMid}>
          {fmtMonthLabel(series.teos[i]!)}
        </text>
      ))}

      {/* Endpoint labels for the gross + NAV series */}
      <g>
        <text
          x={xAt(n - 1) + 4}
          y={yAt(series.gross[n - 1]!) + 3}
          fontSize={10}
          fontWeight={600}
          fill={LAYER_COLORS.gross}
        >
          {fmtPct(series.gross[n - 1]!)}
        </text>
        {series.nav.length > 0 && (
          <text
            x={xAt(n - 1) + 4}
            y={yAt(series.nav[n - 1]!) + 14}
            fontSize={10}
            fontWeight={600}
            fill={LAYER_COLORS.nav}
          >
            NAV {fmtPct(series.nav[n - 1]!)}
          </text>
        )}
      </g>

      {/* Panel title */}
      <text x={x + padL} y={y - 4} fontSize={10} fontWeight={600} fill={PALETTE.textMid}>
        Cumulative Return (%)
      </text>
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Right panel: waterfall
// ─────────────────────────────────────────────────────────────────────

interface WaterfallPanelProps {
  waterfall: AttributionWaterfall;
  x: number;
  y: number;
  width: number;
  height: number;
  yMin: number;
  yMax: number;
}

function WaterfallPanel({ waterfall, x, y, width, height, yMin, yMax }: WaterfallPanelProps) {
  const padL = 8;
  const padR = 60;
  const padT = 8;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const yAt = (v: number) => y + padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  // Build the four contribution bars + a phantom "gross total" bar at the end.
  const bars = [
    { label: "L1 Market", value: waterfall.l1_market, color: LAYER_COLORS.l1_market, hatched: false },
    { label: "L2 Sector", value: waterfall.l2_sector, color: LAYER_COLORS.l2_sector, hatched: false },
    { label: "L3 Subsector", value: waterfall.l3_subsector, color: LAYER_COLORS.l3_subsector, hatched: false },
    { label: "Residual α", value: waterfall.residual, color: LAYER_COLORS.residual, hatched: true },
  ];

  const nBars = bars.length;
  const slot = innerW / (nBars + 0.5); // small extra for the gross marker on the right
  const barW = slot * 0.55;

  // Track running cumulative for each bar's bottom.
  let running = 0;
  const drawn = bars.map((b, i) => {
    const startVal = running;
    const endVal = running + b.value;
    running = endVal;
    const cx = x + padL + slot * i + slot / 2;
    const yTop = yAt(Math.max(startVal, endVal));
    const yBot = yAt(Math.min(startVal, endVal));
    return { ...b, cx, yTop, yBot, endVal };
  });

  return (
    <g>
      {/* Zero line */}
      <line
        x1={x + padL}
        x2={x + padL + innerW + 30}
        y1={yAt(0)}
        y2={yAt(0)}
        stroke={PALETTE.textMid}
        strokeWidth={0.8}
      />

      {/* Y-axis tick on the right edge */}
      {[yMin, 0, yMax].map((v, i) => (
        <text
          key={i}
          x={x + width - padR + 4}
          y={yAt(v) + 3}
          fontSize={9}
          fill={PALETTE.textMid}
        >
          {fmtPct(v, false)}
        </text>
      ))}

      {/* Hatched pattern for residual */}
      <defs>
        <pattern id="hatch-residual" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={LAYER_COLORS.residual} fillOpacity={0.18} />
          <line x1="0" y1="0" x2="0" y2="6" stroke={LAYER_COLORS.residual} strokeWidth={1.4} />
        </pattern>
      </defs>

      {/* Connectors between consecutive bar tops */}
      {drawn.map((b, i) => {
        if (i === 0) return null;
        const prev = drawn[i - 1]!;
        const yLine = yAt(prev.endVal);
        return (
          <line
            key={`conn-${i}`}
            x1={prev.cx + barW / 2}
            x2={b.cx - barW / 2}
            y1={yLine}
            y2={yLine}
            stroke={PALETTE.textLight}
            strokeWidth={0.8}
            strokeDasharray="2 2"
          />
        );
      })}

      {/* Bars + value labels */}
      {drawn.map((b) => {
        const fill = b.hatched ? "url(#hatch-residual)" : b.color;
        const labelY = b.value >= 0 ? b.yTop - 4 : b.yBot + 12;
        return (
          <g key={b.label}>
            <rect
              x={b.cx - barW / 2}
              y={b.yTop}
              width={barW}
              height={Math.max(1, b.yBot - b.yTop)}
              fill={fill}
              stroke={b.color}
              strokeWidth={0.8}
            />
            <text
              x={b.cx}
              y={labelY}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill={PALETTE.textDark}
            >
              {fmtPct(b.value)}
            </text>
            <text
              x={b.cx}
              y={y + height - 8}
              textAnchor="middle"
              fontSize={9}
              fill={PALETTE.textMid}
            >
              {b.label}
            </text>
          </g>
        );
      })}

      {/* NAV endpoint as a separate marker — does NOT participate in the waterfall sum.
          Rendered to the right of the four bars to surface the "13F-vs-realised" gap. */}
      {waterfall.nav != null && (
        <g>
          <line
            x1={x + padL + innerW - 8}
            x2={x + padL + innerW + 12}
            y1={yAt(waterfall.nav)}
            y2={yAt(waterfall.nav)}
            stroke={LAYER_COLORS.nav}
            strokeWidth={2.4}
          />
          <text
            x={x + padL + innerW + 16}
            y={yAt(waterfall.nav) + 3}
            fontSize={10}
            fontWeight={700}
            fill={LAYER_COLORS.nav}
          >
            NAV {fmtPct(waterfall.nav)}
          </text>
        </g>
      )}

      {/* Panel title */}
      <text x={x + padL} y={y - 4} fontSize={10} fontWeight={600} fill={PALETTE.textMid}>
        Return Contribution (%)
      </text>
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────

export function CumulativeChart({
  series,
  waterfall,
  width = 760,
  height = 240,
}: CumulativeChartProps) {
  // Shared y-axis domain so the tie-line height matches across panels.
  const lineVals = [
    ...series.l1_market,
    ...series.l2_sector,
    ...series.l3_subsector,
    ...series.residual,
    ...series.gross,
    ...series.nav,
  ];
  const wfVals = [0, waterfall.l1_market, waterfall.gross, waterfall.nav].filter(
    (v): v is number => v != null,
  );
  const allVals = lineVals.concat(wfVals);
  if (allVals.length === 0) {
    return (
      <svg width={width} height={height}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill={PALETTE.textMid}>
          No data available for I. Cumulative Returns
        </text>
      </svg>
    );
  }
  const dataMin = Math.min(...allVals, 0);
  const dataMax = Math.max(...allVals, 0);
  const span = Math.max(0.05, dataMax - dataMin);
  const yMin = Math.floor((dataMin - span * 0.08) * 20) / 20; // round to 5%
  const yMax = Math.ceil((dataMax + span * 0.08) * 20) / 20;

  // 60/40 left-right split with a small horizontal gap.
  const gap = 24;
  const leftW = Math.round(width * 0.6) - gap / 2;
  const rightW = width - leftW - gap;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      <LinePanel
        series={series}
        x={0}
        y={16}
        width={leftW}
        height={height - 16}
        yMin={yMin}
        yMax={yMax}
      />
      <WaterfallPanel
        waterfall={waterfall}
        x={leftW + gap}
        y={16}
        width={rightW}
        height={height - 16}
        yMin={yMin}
        yMax={yMax}
      />
    </svg>
  );
}
