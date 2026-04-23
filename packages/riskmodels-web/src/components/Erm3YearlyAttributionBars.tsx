'use client';

import type { WalkthroughYearBar } from '../types/walkthrough';
import { RISKMODELS_THEME } from '../theme';

type BarSeg = {
  key: 'l1' | 'l2' | 'l3' | 'res';
  field: keyof Pick<WalkthroughYearBar, 'l1_pp' | 'l2_pp' | 'l3_pp' | 'res_pp'>;
  label: string;
  color: string;
  step: number;
};

const BAR_SEGMENTS: BarSeg[] = [
  { key: 'l1', field: 'l1_pp', label: 'Market', color: RISKMODELS_THEME.chart.barMarket, step: 1 },
  { key: 'l2', field: 'l2_pp', label: 'Sector', color: RISKMODELS_THEME.chart.barSector, step: 2 },
  { key: 'l3', field: 'l3_pp', label: 'Sub-sector', color: RISKMODELS_THEME.chart.barSubsector, step: 3 },
  { key: 'res', field: 'res_pp', label: 'Residual', color: RISKMODELS_THEME.chart.barResidual, step: 4 },
];

function formatPp(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  const abs = Math.abs(v);
  const t = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  return `${sign}${t}%`;
}

export interface Erm3YearlyAttributionBarsProps {
  bars: WalkthroughYearBar[];
  visibleThrough: number;
  sectorEtf: string | null;
  subsectorEtf: string | null;
  /** Prefix SVG pattern ids to avoid clashes when multiple charts mount. */
  hatchIdPrefix?: string;
}

export function Erm3YearlyAttributionBars({
  bars,
  visibleThrough,
  sectorEtf,
  subsectorEtf,
  hatchIdPrefix = 'rmw',
}: Erm3YearlyAttributionBarsProps) {
  const W = 480;
  const H = 340;
  const M = { top: 36, right: 12, bottom: 52, left: 40 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  let yMin = 0;
  let yMax = 0;
  for (const b of bars) {
    let pos = 0;
    let neg = 0;
    for (const seg of BAR_SEGMENTS) {
      const v = b[seg.field] as number;
      if (v >= 0) pos += v;
      else neg += v;
    }
    yMax = Math.max(yMax, pos, b.gross_pp);
    yMin = Math.min(yMin, neg, b.gross_pp);
  }
  const pad = Math.max(6, (yMax - yMin) * 0.12);
  yMin -= pad;
  yMax += pad;
  const range = yMax - yMin || 1;
  const yScale = (v: number) => M.top + innerH - ((v - yMin) / range) * innerH;

  const n = bars.length;
  const bandW = innerW / n;
  const barW = Math.min(64, bandW * 0.55);

  const raw = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(0.01, raw))));
  const norm = raw / mag;
  const niceStep = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const tickStart = Math.ceil(yMin / niceStep) * niceStep;
  const yTicks: number[] = [];
  for (let t = tickStart; t <= yMax; t += niceStep) yTicks.push(t);

  const thisYear = new Date().getUTCFullYear();
  const labelForYear = (yr: number) => {
    if (yr === thisYear) return 'YTD';
    if (yr === thisYear - 2) return `${yr}\n(yt-2)`;
    if (yr === thisYear - 1) return `${yr}\n(yt-1)`;
    return String(yr);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label="Yearly attribution">
      <defs>
        {BAR_SEGMENTS.map((seg) => (
          <pattern
            key={seg.key}
            id={`${hatchIdPrefix}-hatch-${seg.key}`}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" fill={seg.color} opacity={0.22} />
            <path
              d="M0,8 L8,0 M-2,2 L2,-2 M6,10 L10,6"
              stroke={seg.color}
              strokeWidth={1.4}
              opacity={0.95}
            />
          </pattern>
        ))}
      </defs>

      {yTicks.map((t) => (
        <g key={`gy-${t}`}>
          <line
            x1={M.left}
            x2={W - M.right}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="rgba(63,63,70,0.9)"
            strokeDasharray={t === 0 ? '0' : '4 4'}
            strokeWidth={t === 0 ? 1.2 : 1}
          />
          <text x={M.left - 6} y={yScale(t) + 4} fontSize={10} fill="#71717a" textAnchor="end">
            {t.toFixed(0)}%
          </text>
        </g>
      ))}

      <g transform={`translate(${M.left}, 8)`}>
        {BAR_SEGMENTS.map((seg, i) => {
          const faded = seg.step > visibleThrough;
          const label =
            seg.key === 'l2' && sectorEtf
              ? `${seg.label} (${sectorEtf})`
              : seg.key === 'l3' && subsectorEtf
                ? `${seg.label} (${subsectorEtf})`
                : seg.label;
          return (
            <g key={seg.key} transform={`translate(${i * 88}, 0)`} opacity={faded ? 0.28 : 1}>
              <rect width={10} height={10} fill={seg.color} rx={2} />
              <text x={14} y={9} fontSize={9} fill="#a1a1aa">
                {label}
              </text>
            </g>
          );
        })}
      </g>

      {bars.map((b, i) => {
        const cx = M.left + bandW * i + bandW / 2;
        const x0 = cx - barW / 2;
        let posCursor = 0;
        let negCursor = 0;

        return (
          <g key={b.year}>
            {BAR_SEGMENTS.map((seg) => {
              const v = b[seg.field] as number;
              const faded = seg.step > visibleThrough;
              const opacity = faded ? 0.14 : 1;
              let top: number;
              let bottom: number;
              if (v >= 0) {
                bottom = yScale(posCursor);
                top = yScale(posCursor + v);
                posCursor += v;
              } else {
                top = yScale(negCursor);
                bottom = yScale(negCursor + v);
                negCursor += v;
              }
              const h = Math.max(1.5, bottom - top);
              const fill = v < 0 ? `url(#${hatchIdPrefix}-hatch-${seg.key})` : seg.color;
              const midY = (top + bottom) / 2;
              const labelFs = h < 16 ? 9 : 11;

              return (
                <g key={seg.key}>
                  <rect
                    x={x0}
                    y={top}
                    width={barW}
                    height={h}
                    fill={fill}
                    opacity={opacity}
                    stroke={seg.color}
                    strokeOpacity={v < 0 ? 0.85 : 0.35}
                    strokeWidth={1}
                    rx={2}
                  />
                  <text
                    x={cx}
                    y={midY + (labelFs === 9 ? 3 : 4)}
                    fontSize={labelFs}
                    fontWeight={700}
                    fill="#fafafa"
                    textAnchor="middle"
                    style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
                  >
                    {formatPp(v)}
                  </text>
                </g>
              );
            })}

            <text
              x={cx}
              y={yScale(b.gross_pp) - 8}
              fontSize={11}
              fontWeight={800}
              fill={b.gross_pp < 0 ? '#f87171' : '#f4f4f5'}
              textAnchor="middle"
            >
              {formatPp(b.gross_pp)}
            </text>

            <text
              x={cx}
              y={H - M.bottom + 14}
              fontSize={11}
              fontWeight={600}
              fill="#e4e4e7"
              textAnchor="middle"
            >
              {labelForYear(b.year).split('\n').map((line, li) => (
                <tspan key={li} x={cx} dy={li === 0 ? 0 : 12}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
