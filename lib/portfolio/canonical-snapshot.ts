/**
 * Canonical JSON portfolio snapshot for POST /api/snapshot (type: portfolio).
 * Reuses runPortfolioRiskComputation + V3 Zarr history (fetchBatchHistory); no duplicated risk math.
 */

import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  fetchBatchHistory,
  fetchLatestMetricsWithFallback,
  resolveSymbolsByTickers,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import {
  normalizeWeights,
  runPortfolioRiskComputation,
} from "@/lib/portfolio/portfolio-risk-core";

const RETURN_LAYER_KEYS: V3MetricKey[] = [
  "returns_gross",
  "l1_fr",
  "l2_fr",
  "l3_fr",
  "l3_rr",
  "vol_23d",
];

export type SnapshotPortfolioRow = {
  ticker: string;
  weight?: number;
  shares?: number;
};

export type CanonicalSnapshotResponse = {
  snapshot: {
    as_of: string;
    lookback_trading_days: number;
    mode: "frozen";
    benchmark: string | null;
    positions: Array<{
      ticker: string;
      weight: number;
      symbol: string;
      teo: string | null;
      l3_mkt_er: number | null;
      l3_sec_er: number | null;
      l3_sub_er: number | null;
      l3_res_er: number | null;
      l3_mkt_hr: number | null;
      l3_sec_hr: number | null;
      l3_sub_hr: number | null;
      vol_23d: number | null;
    }>;
    variance_decomposition: {
      market: number;
      sector: number;
      subsector: number;
      residual: number;
      systematic: number;
    };
    portfolio_volatility_23d: number | null;
    unresolved: { ticker: string; error: string }[];
  };
  time_behavior: {
    teo: string[];
    cumulative_return: number[];
    drawdown: number[];
  };
  attribution: {
    teo: string[];
    /** Portfolio daily returns (frozen weights). */
    gross: number[];
    market: number[];
    sector: number[];
    subsector: number[];
    residual: number[];
    /** sector/subsector are incremental strips: l2−l1, l3−l2 (when data available). */
    systematic: number[];
  };
  risk_summary: {
    dominant_drivers: string[];
    concentration: {
      high_single_name: boolean;
      high_layer_concentration: boolean;
    };
    top_exposures: Array<{
      ticker: string;
      weight: number;
      l3_mkt_er: number | null;
      l3_sec_er: number | null;
      l3_sub_er: number | null;
    }>;
    systematic_risk_share: number;
  };
  metadata: {
    data_as_of: string;
    lookback_days: number;
    mode: string;
    benchmark: string | null;
  };
};

/**
 * Convert validated snapshot rows to normalized weights (shares → notionals via latest price_close).
 */
export async function resolveSnapshotPortfolioToWeights(
  rows: SnapshotPortfolioRow[],
): Promise<{ ok: true; positions: { ticker: string; weight: number }[] } | { ok: false; error: string; status: number }> {
  if (rows.length === 0) {
    return { ok: false, error: "No positions", status: 400 };
  }
  const allWeight = rows.every((r) => r.weight != null);
  if (allWeight) {
    const positions = rows.map((r) => ({ ticker: r.ticker, weight: r.weight! }));
    return { ok: true, positions: normalizeWeights(positions) };
  }

  const symMap = await resolveSymbolsByTickers(rows.map((r) => r.ticker));
  const notional: { ticker: string; weight: number }[] = [];
  for (const r of rows) {
    const rec = symMap.get(r.ticker);
    if (!rec) {
      return {
        ok: false,
        error: `Symbol not found for ticker ${r.ticker}`,
        status: 400,
      };
    }
    const latest = await fetchLatestMetricsWithFallback(rec.symbol, ["price_close"], "daily");
    const px = latest?.metrics?.price_close;
    if (px == null || !Number.isFinite(px) || px <= 0) {
      return {
        ok: false,
        error: `Could not resolve price_close for ${r.ticker}`,
        status: 400,
      };
    }
    notional.push({ ticker: r.ticker, weight: (r.shares! * px) });
  }
  return { ok: true, positions: normalizeWeights(notional) };
}

function yearsForLookback(lookbackDays: number): number {
  return Math.min(15, Math.max(1, Math.ceil(lookbackDays / 200)));
}

function num(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return 0;
  return x;
}

/**
 * Build cumulative return and drawdown from daily simple returns.
 */
function compoundAndDrawdown(daily: number[]): { cumulative: number[]; drawdown: number[] } {
  const cumulative: number[] = [];
  const drawdown: number[] = [];
  let w = 1;
  let peak = 1;
  for (const r of daily) {
    w *= 1 + r;
    cumulative.push(w - 1);
    if (w > peak) peak = w;
    drawdown.push(peak > 0 ? w / peak - 1 : 0);
  }
  return { cumulative, drawdown };
}

export async function buildCanonicalPortfolioSnapshot(input: {
  positions: { ticker: string; weight: number }[];
  lookbackDays: number;
  mode: "frozen";
  benchmark: string | null;
}): Promise<
  { ok: true; body: CanonicalSnapshotResponse } | { ok: false; error: string; status: number; details?: unknown }
> {
  const { positions, lookbackDays, mode, benchmark } = input;
  const years = yearsForLookback(lookbackDays);

  const core = await runPortfolioRiskComputation(positions, {
    timeSeries: true,
    years,
    includeHedgeRatios: true,
  });

  if (core.status === "invalid") {
    return {
      ok: false,
      error: "No valid positions",
      status: 400,
      details: core.errors,
    };
  }
  if (core.status === "syncing") {
    return { ok: false, error: "No positions to process", status: 400 };
  }
  if (core.status !== "ok") {
    return { ok: false, error: "Unexpected portfolio state", status: 500 };
  }

  const weightMap = new Map(
    positions.map((p) => [p.ticker, p.weight] as const),
  );
  const tickers = positions.map((p) => p.ticker);
  const symbolMap = await resolveSymbolsByTickers(tickers);
  const resolvedTickers = tickers.filter((t) => symbolMap.has(t));
  if (resolvedTickers.length === 0) {
    return { ok: false, error: "No resolvable tickers", status: 400 };
  }

  const startDate = new Date();
  startDate.setUTCFullYear(startDate.getUTCFullYear() - years);
  const startStr = startDate.toISOString().slice(0, 10);
  const symbols = resolvedTickers.map((t) => symbolMap.get(t)!.symbol);

  const rows = await fetchBatchHistory(symbols, RETURN_LAYER_KEYS, {
    periodicity: "daily",
    startDate: startStr,
    orderBy: "asc",
  });

  const byDate = new Map<string, Map<string, Record<string, number | null>>>();
  for (const row of rows) {
    if (!byDate.has(row.teo)) byDate.set(row.teo, new Map());
    const dm = byDate.get(row.teo)!;
    const t = resolvedTickers.find((u) => symbolMap.get(u)?.symbol === row.symbol);
    if (!t) continue;
    if (!dm.has(t)) dm.set(t, {});
    const cell = dm.get(t)!;
    cell[row.metric_key] = row.metric_value;
  }

  const sortedTeos = Array.from(byDate.keys()).sort();
  const gross: number[] = [];
  const market: number[] = [];
  const sector: number[] = [];
  const subsector: number[] = [];
  const residual: number[] = [];
  const systematicDaily: number[] = [];
  const teoOut: string[] = [];

  for (const teo of sortedTeos) {
    const dateMap = byDate.get(teo)!;
    let dayComplete = true;
    for (const t of resolvedTickers) {
      const m = dateMap.get(t);
      if (
        !m ||
        m.returns_gross == null ||
        m.l1_fr == null ||
        m.l2_fr == null ||
        m.l3_fr == null ||
        m.l3_rr == null
      ) {
        dayComplete = false;
        break;
      }
    }
    if (!dayComplete) continue;

    const layerSums = {
      gross: 0,
      mkt: 0,
      sec: 0,
      sub: 0,
      res: 0,
    };
    for (const t of resolvedTickers) {
      const w = weightMap.get(t) ?? 0;
      const m = dateMap.get(t)!;
      const g = m.returns_gross!;
      const l1 = m.l1_fr!;
      const l2 = m.l2_fr!;
      const l3 = m.l3_fr!;
      const rr = m.l3_rr!;
      layerSums.gross += w * num(g);
      layerSums.mkt += w * num(l1);
      const secStrip = num(l2) - num(l1);
      const subStrip = num(l3) - num(l2);
      layerSums.sec += w * secStrip;
      layerSums.sub += w * subStrip;
      layerSums.res += w * num(rr);
    }
    teoOut.push(teo);
    gross.push(layerSums.gross);
    market.push(layerSums.mkt);
    sector.push(layerSums.sec);
    subsector.push(layerSums.sub);
    residual.push(layerSums.res);
    systematicDaily.push(layerSums.mkt + layerSums.sec + layerSums.sub);
  }

  const sliceStart = Math.max(0, teoOut.length - lookbackDays);
  const teoS = teoOut.slice(sliceStart);
  const gS = gross.slice(sliceStart);
  const mS = market.slice(sliceStart);
  const sS = sector.slice(sliceStart);
  const uS = subsector.slice(sliceStart);
  const rS = residual.slice(sliceStart);
  const sysS = systematicDaily.slice(sliceStart);

  const { cumulative, drawdown } = compoundAndDrawdown(gS);

  const firstTicker = resolvedTickers[0]!;
  const asOf = String(
    (core.perTicker[firstTicker] as { teo?: string })?.teo ?? "",
  );
  const meta = await getRiskMetadata();

  const perPositions: CanonicalSnapshotResponse["snapshot"]["positions"] = [];
  for (const t of resolvedTickers) {
    const pt = core.perTicker[t] as Record<string, unknown>;
    perPositions.push({
      ticker: t,
      weight: Number(pt.weight ?? 0),
      symbol: String(pt.symbol ?? ""),
      teo: (pt.teo as string) ?? null,
      l3_mkt_er: (pt.l3_mkt_er as number) ?? null,
      l3_sec_er: (pt.l3_sec_er as number) ?? null,
      l3_sub_er: (pt.l3_sub_er as number) ?? null,
      l3_res_er: (pt.l3_res_er as number) ?? null,
      l3_mkt_hr: (pt.l3_mkt_hr as number) ?? null,
      l3_sec_hr: (pt.l3_sec_hr as number) ?? null,
      l3_sub_hr: (pt.l3_sub_hr as number) ?? null,
      vol_23d: (pt.vol_23d as number) ?? null,
    });
  }
  perPositions.sort((a, b) => b.weight - a.weight);

  const maxW = perPositions[0]?.weight ?? 0;
  const highSingle = maxW > 0.4;
  const er = core.portfolioER;
  const layerMax = Math.max(er.market, er.sector, er.subsector);
  const highLayer = layerMax > 0.55;

  const driverScores: { label: string; value: number }[] = [
    { label: "market", value: er.market },
    { label: "sector", value: er.sector },
    { label: "subsector", value: er.subsector },
    { label: "residual", value: er.residual },
  ].sort((a, b) => b.value - a.value);
  const dominant_drivers = driverScores.slice(0, 3).map((d) => d.label);

  const top_exposures = perPositions.slice(0, 10).map((p) => ({
    ticker: p.ticker,
    weight: p.weight,
    l3_mkt_er: p.l3_mkt_er,
    l3_sec_er: p.l3_sec_er,
    l3_sub_er: p.l3_sub_er,
  }));

  const systematicEr = core.systematic;
  const systematic_risk_share =
    systematicEr + er.residual > 0
      ? systematicEr / (systematicEr + er.residual)
      : 0;

  const body: CanonicalSnapshotResponse = {
    snapshot: {
      as_of: asOf || meta.data_as_of,
      lookback_trading_days: teoS.length,
      mode,
      benchmark: benchmark,
      positions: perPositions,
      variance_decomposition: {
        market: er.market,
        sector: er.sector,
        subsector: er.subsector,
        residual: er.residual,
        systematic: core.systematic,
      },
      portfolio_volatility_23d: core.portfolioVol,
      unresolved: core.errorsList,
    },
    time_behavior: {
      teo: teoS,
      cumulative_return: cumulative,
      drawdown,
    },
    attribution: {
      teo: teoS,
      gross: gS,
      market: mS,
      sector: sS,
      subsector: uS,
      residual: rS,
      systematic: sysS,
    },
    risk_summary: {
      dominant_drivers,
      concentration: {
        high_single_name: highSingle,
        high_layer_concentration: highLayer,
      },
      top_exposures,
      systematic_risk_share,
    },
    metadata: {
      data_as_of: meta.data_as_of,
      lookback_days: lookbackDays,
      mode,
      benchmark: benchmark,
    },
  };

  return { ok: true, body };
}
