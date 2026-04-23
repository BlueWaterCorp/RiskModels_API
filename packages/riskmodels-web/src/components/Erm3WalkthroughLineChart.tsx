'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ERM3_WALKTHROUGH_LINE_SERIES, type WalkthroughLineSeriesKey } from '../line-series';

export type WalkthroughChartRow = {
  date: string;
  gross: number;
  marketHedged: number;
  sectorHedged: number;
  residual: number;
};

export interface Erm3WalkthroughLineChartProps {
  rows: WalkthroughChartRow[];
  /** 1–4: how many series to show (peel). */
  activeStep: number;
  className?: string;
  height?: number | string;
}

export function Erm3WalkthroughLineChart({
  rows,
  activeStep,
  className,
  height = 320,
}: Erm3WalkthroughLineChartProps) {
  const step = Math.min(4, Math.max(1, activeStep));
  const visible = ERM3_WALKTHROUGH_LINE_SERIES.slice(0, step);

  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#71717a', fontSize: 11 }}
            tickFormatter={(v) => (typeof v === 'string' ? v.slice(0, 7) : String(v))}
            minTickGap={48}
          />
          <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={(v) => `${v}%`} width={44} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(l) => (typeof l === 'string' ? l : String(l))}
            formatter={(value: number | string, name: string) => {
              const n = typeof value === 'number' ? value : Number(value);
              const pct = Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
              return [pct, name];
            }}
          />
          {visible.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key as WalkthroughLineSeriesKey}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.key === 'gross' ? 2 : 2.25}
              strokeDasharray={s.dash}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
