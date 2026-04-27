"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Position = { ticker: string; weight?: number; shares?: number };
type Props = { portfolio: Position[] };

type SnapshotResponse = {
  time_behavior?: { teo?: string[]; cumulative_return?: number[] };
  attribution?: {
    market?: number[];
    sector?: number[];
    subsector?: number[];
    residual?: number[];
  };
};

function toWealth(series: number[]) {
  return series.map((v) => 1 + v);
}

function rebase(series: number[], baseIndex: number) {
  const base = series[baseIndex] || 1;
  return series.map((v) => v / base);
}

function rebaseAttr(series: number[], baseIndex: number) {
  const base = series[baseIndex] ?? 0;
  return series.map((v) => v - base);
}

const ATTR_AREAS = [
  ["market", "#8884d8"],
  ["sector", "#82ca9d"],
  ["subsector", "#ffc658"],
  ["residual", "#ff7300"],
] as const;

export function PortfolioSnapshotChart({ portfolio }: Props) {
  const [dates, setDates] = useState<string[]>([]);
  const [portfolioSeries, setPortfolioSeries] = useState<number[]>([]);
  const [attribution, setAttribution] = useState({
    market: [] as number[],
    sector: [] as number[],
    subsector: [] as number[],
    residual: [] as number[],
  });
  const [baseIndex, setBaseIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "portfolio", portfolio, lookback_days: 252 }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || "Snapshot request failed");
        return res.json() as Promise<SnapshotResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        setDates(body.time_behavior?.teo ?? []);
        setPortfolioSeries(toWealth(body.time_behavior?.cumulative_return ?? []));
        setAttribution({
          market: body.attribution?.market ?? [],
          sector: body.attribution?.sector ?? [],
          subsector: body.attribution?.subsector ?? [],
          residual: body.attribution?.residual ?? [],
        });
        setBaseIndex(0);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Snapshot request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [portfolio]);

  const rows = useMemo(
    () =>
      dates.map((date, i) => {
        const row: Record<string, string | number> = { date };
        row.portfolio = rebase(portfolioSeries, baseIndex)[i] ?? 1;
        row.market = rebaseAttr(attribution.market, baseIndex)[i] ?? 0;
        row.sector = rebaseAttr(attribution.sector, baseIndex)[i] ?? 0;
        row.subsector = rebaseAttr(attribution.subsector, baseIndex)[i] ?? 0;
        row.residual = rebaseAttr(attribution.residual, baseIndex)[i] ?? 0;
        return row;
      }),
    [dates, portfolioSeries, attribution, baseIndex],
  );

  if (loading) return <div className="text-sm text-zinc-500">Loading portfolio snapshot...</div>;
  if (error) return <div className="text-sm text-red-600">Snapshot failed: {error}</div>;
  if (!dates.length || !portfolioSeries.length) return <div className="text-sm text-zinc-500">No snapshot data available.</div>;

  return (
    <div className="w-full space-y-3">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(0, 7)} minTickGap={44} />
            <YAxis yAxisId="price" tickFormatter={(v) => Number(v).toFixed(2)} width={48} />
            <YAxis yAxisId="attr" orientation="right" tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} width={52} />
            <Tooltip formatter={(v: number | string, name: string) => {
              const n = Number(v);
              return [name === "Portfolio" ? n.toFixed(3) : `${(n * 100).toFixed(2)}%`, name];
            }} />
            {ATTR_AREAS.map(([key, color]) => (
              <Area key={key} yAxisId="attr" type="monotone" dataKey={key} stackId="1" fill={color} stroke={color} fillOpacity={0.6} />
            ))}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="portfolio"
              name="Portfolio"
              stroke="#000"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, dates.length - 1)}
        value={baseIndex}
        onChange={(e) => setBaseIndex(Number(e.target.value))}
        className="w-full"
      />
      <div className="text-sm text-zinc-600">Viewing from: {dates[baseIndex]}</div>
    </div>
  );
}

export default PortfolioSnapshotChart;
