/**
 * Fetch ETF daily returns and build Pearson correlation matrices
 * for use by the diversification metrics computation.
 */

import {
  resolveSymbolsByTickers,
  fetchBatchHistory,
  pivotHistory,
} from "@/lib/dal/risk-engine-v3";
import type { CorrelationMatrix } from "./portfolio-diversification";

const MIN_OVERLAP = 30;

function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < MIN_OVERLAP) return null;
  const n = a.length;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  if (denA === 0 || denB === 0) return null;
  return num / Math.sqrt(denA * denB);
}

async function buildCorrelationMatrix(
  etfTickers: string[],
  windowDays: number,
): Promise<CorrelationMatrix> {
  if (etfTickers.length === 0) return { etfs: [], R: [] };
  if (etfTickers.length === 1) return { etfs: etfTickers, R: [[1]] };

  const symbolMap = await resolveSymbolsByTickers(etfTickers);
  const symbols: string[] = [];
  const resolvedTickers: string[] = [];
  for (const t of etfTickers) {
    const rec = symbolMap.get(t);
    if (rec) {
      symbols.push(rec.symbol);
      resolvedTickers.push(t);
    }
  }

  if (symbols.length === 0) return { etfs: [], R: [] };
  if (symbols.length === 1) return { etfs: resolvedTickers, R: [[1]] };

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.ceil(windowDays * 1.5));
  const startStr = startDate.toISOString().slice(0, 10);

  const rows = await fetchBatchHistory(symbols, ["returns_gross"], {
    periodicity: "daily",
    startDate: startStr,
    orderBy: "asc",
  });

  const bySym = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.metric_value == null || !Number.isFinite(row.metric_value)) continue;
    if (!bySym.has(row.symbol)) bySym.set(row.symbol, new Map());
    bySym.get(row.symbol)!.set(row.teo, row.metric_value);
  }

  const allDates = new Set<string>();
  for (const m of bySym.values()) for (const d of m.keys()) allDates.add(d);
  const sortedDates = [...allDates].sort().slice(-windowDays);

  const n = resolvedTickers.length;
  const series: number[][] = resolvedTickers.map((t) => {
    const sym = symbolMap.get(t)!.symbol;
    const m = bySym.get(sym);
    return sortedDates.map((d) => m?.get(d) ?? NaN);
  });

  const R: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    R[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const aligned: [number[], number[]] = [[], []];
      for (let d = 0; d < sortedDates.length; d++) {
        if (Number.isFinite(series[i][d]) && Number.isFinite(series[j][d])) {
          aligned[0].push(series[i][d]);
          aligned[1].push(series[j][d]);
        }
      }
      const rho = pearson(aligned[0], aligned[1]) ?? 0;
      R[i][j] = rho;
      R[j][i] = rho;
    }
  }

  return { etfs: resolvedTickers, R };
}

export async function fetchEtfCorrelationMatrices(
  sectorEtfs: string[],
  subsectorEtfs: string[],
  windowDays: number,
): Promise<{
  sector: CorrelationMatrix;
  subsector: CorrelationMatrix;
}> {
  const [sector, subsector] = await Promise.all([
    buildCorrelationMatrix(sectorEtfs, windowDays),
    buildCorrelationMatrix(subsectorEtfs, windowDays),
  ]);
  return { sector, subsector };
}
