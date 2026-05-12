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
import {
  computeDiversificationMetrics,
  type CorrelationMatrix,
  type DiversificationResult,
  type DiversificationTickerMetrics,
} from "@/lib/portfolio/portfolio-diversification";
import { fetchEtfCorrelationMatrices } from "@/lib/portfolio/portfolio-diversification-etf-returns";

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
    /** Populated only when the request was `type: "ticker"`. */
    ticker_meta?: {
      ticker: string;
      symbol: string;
      sector_etf: string | null;
      subsector_etf: string | null;
      asset_type: string | null;
      /** Active L3 factors for this ticker: [SPY, sector_etf, subsector_etf] (deduped). */
      factors: string[];
    };
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
    /**
     * Diversification-adjusted shares of the *portfolio's* variance, renormalized
     * to sum to ~1. Position residuals are largely uncorrelated, so a portfolio's
     * idiosyncratic variance is far smaller than the naive position-weighted sum;
     * sector/subsector exposures partially cancel via realized ETF correlations.
     * The naive PWS figures, the credit, and per-layer multipliers are in
     * `diversification` below. (Falls back to the naive decomposition only if the
     * adjusted total is degenerate.)
     */
    variance_decomposition: {
      market: number;
      sector: number;
      subsector: number;
      residual: number;
      systematic: number;
    };
    /**
     * Naive (position-weighted-sum, "if residuals were perfectly correlated")
     * vs correlation-adjusted decomposition + per-layer diversification credit.
     * `correlation_adjusted` is in variance-fraction-of-average-position units
     * (so its `total` is < 1 by the total diversification benefit);
     * `variance_decomposition` above is that, renormalized to the portfolio's
     * own variance.
     */
    diversification: DiversificationResult;
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
    /** Present when daily series used a relaxed same-day coverage threshold (sparse factor history). */
    time_series_caveat?: string;
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

/** All layer inputs present for frozen-weight attribution on this date. */
function layerRowComplete(m: Record<string, number | null> | undefined): boolean {
  return (
    !!m &&
    m.returns_gross != null &&
    m.l1_fr != null &&
    m.l2_fr != null &&
    m.l3_fr != null &&
    m.l3_rr != null
  );
}

function aggregatePortfolioDailySeries(
  sortedTeos: string[],
  byDate: Map<string, Map<string, Record<string, number | null>>>,
  resolvedTickers: string[],
  weightMap: Map<string, number>,
  /** Minimum fraction of resolved portfolio weight that must have complete strips (same calendar day). */
  minWeightCoverage: number,
): {
  teoOut: string[];
  gross: number[];
  market: number[];
  sector: number[];
  subsector: number[];
  residual: number[];
  systematicDaily: number[];
} {
  const teoOut: string[] = [];
  const gross: number[] = [];
  const market: number[] = [];
  const sector: number[] = [];
  const subsector: number[] = [];
  const residual: number[] = [];
  const systematicDaily: number[] = [];

  const totalW = resolvedTickers.reduce((s, t) => s + (weightMap.get(t) ?? 0), 0);

  for (const teo of sortedTeos) {
    const dateMap = byDate.get(teo)!;
    let wCov = 0;
    const complete: string[] = [];
    for (const t of resolvedTickers) {
      const m = dateMap.get(t);
      if (!layerRowComplete(m)) continue;
      wCov += weightMap.get(t) ?? 0;
      complete.push(t);
    }
    const coverRatio = totalW > 0 ? wCov / totalW : 0;
    if (coverRatio + 1e-9 < minWeightCoverage) continue;

    const rn = wCov > 0 ? 1 / wCov : 0;
    let gSum = 0;
    let mSum = 0;
    let sSum = 0;
    let uSum = 0;
    let rSum = 0;
    for (const tk of complete) {
      const w = (weightMap.get(tk) ?? 0) * rn;
      const m = dateMap.get(tk)!;
      const g = m.returns_gross!;
      const l1 = m.l1_fr!;
      const l2 = m.l2_fr!;
      const l3 = m.l3_fr!;
      const rr = m.l3_rr!;
      gSum += w * num(g);
      mSum += w * num(l1);
      const secStrip = num(l2) - num(l1);
      const subStrip = num(l3) - num(l2);
      sSum += w * secStrip;
      uSum += w * subStrip;
      rSum += w * num(rr);
    }
    teoOut.push(teo);
    gross.push(gSum);
    market.push(mSum);
    sector.push(sSum);
    subsector.push(uSum);
    residual.push(rSum);
    systematicDaily.push(mSum + sSum + uSum);
  }

  return { teoOut, gross, market, sector, subsector, residual, systematicDaily };
}

function resolveDailySeriesWithCoverageFallback(
  sortedTeos: string[],
  byDate: Map<string, Map<string, Record<string, number | null>>>,
  resolvedTickers: string[],
  weightMap: Map<string, number>,
): {
  teoOut: string[];
  gross: number[];
  market: number[];
  sector: number[];
  subsector: number[];
  residual: number[];
  systematicDaily: number[];
  coverageTierUsed: number;
} {
  const tiers = [1 - 1e-9, 0.94, 0.8] as const;
  for (const tier of tiers) {
    const s = aggregatePortfolioDailySeries(
      sortedTeos,
      byDate,
      resolvedTickers,
      weightMap,
      tier,
    );
    if (s.teoOut.length > 0) return { ...s, coverageTierUsed: tier };
  }
  return {
    teoOut: [],
    gross: [],
    market: [],
    sector: [],
    subsector: [],
    residual: [],
    systematicDaily: [],
    coverageTierUsed: tiers[tiers.length - 1]!,
  };
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

  const daily = resolveDailySeriesWithCoverageFallback(
    sortedTeos,
    byDate,
    resolvedTickers,
    weightMap,
  );
  const { teoOut, gross, market, sector, subsector, residual, systematicDaily, coverageTierUsed } =
    daily;

  const sliceStart = Math.max(0, teoOut.length - lookbackDays);
  const teoS = teoOut.slice(sliceStart);
  const gS = gross.slice(sliceStart);
  const mS = market.slice(sliceStart);
  const sS = sector.slice(sliceStart);
  const uS = subsector.slice(sliceStart);
  const rS = residual.slice(sliceStart);
  const sysS = systematicDaily.slice(sliceStart);

  let timeSeriesCaveat: string | undefined;
  if (teoS.length > 0 && coverageTierUsed < 1 - 1e-9) {
    timeSeriesCaveat = `Daily return / attribution lines include only dates where at least ${(coverageTierUsed * 100).toFixed(0)}% of portfolio weight had full gross + factor strips; holdings missing that day were dropped and the rest were reweighted to sum to one for that day's portfolio return (frozen weights elsewhere).`;
  }

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

  // ── Diversification-adjusted decomposition ───────────────────────────────
  // `core.portfolioER` is the naive position-weighted sum (treats the book as
  // one weighted-average position — wrong for residual, which is ~uncorrelated
  // across names, and overstated for sector/subsector). Compute the
  // correlation-adjusted decomposition and make *that* the headline. The naive
  // figures + the credit stay available in `snapshot.diversification`.
  const tickerMetrics = new Map<string, DiversificationTickerMetrics>();
  const sectorEtfSet = new Set<string>();
  const subsectorEtfSet = new Set<string>();
  for (const t of resolvedTickers) {
    const pt = core.perTicker[t] as Record<string, unknown>;
    const sectorEtf =
      (pt.sector_etf as string | undefined) ?? symbolMap.get(t)?.sector_etf ?? null;
    const subsectorEtf =
      (pt.subsector_etf as string | undefined) ?? symbolMap.get(t)?.subsector_etf ?? null;
    tickerMetrics.set(t, {
      l3_mkt_er: (pt.l3_mkt_er as number) ?? null,
      l3_sec_er: (pt.l3_sec_er as number) ?? null,
      l3_sub_er: (pt.l3_sub_er as number) ?? null,
      l3_res_er: (pt.l3_res_er as number) ?? null,
      sector_etf: sectorEtf,
      subsector_etf: subsectorEtf,
    });
    if (sectorEtf) sectorEtfSet.add(sectorEtf);
    if (subsectorEtf) subsectorEtfSet.add(subsectorEtf);
  }

  let etfCorrelations: { sector: CorrelationMatrix; subsector: CorrelationMatrix } = {
    sector: { etfs: [], R: [] },
    subsector: { etfs: [], R: [] },
  };
  try {
    etfCorrelations = await fetchEtfCorrelationMatrices(
      [...sectorEtfSet],
      [...subsectorEtfSet],
      lookbackDays,
    );
  } catch {
    // Non-fatal: residual still gets its concentration multiplier (needs no
    // correlations); sector/subsector simply receive no diversification credit.
  }

  // `positions` are already normalized to sum to 1 (resolveSnapshotPortfolioToWeights
  // → normalizeWeights); computeDiversificationMetrics skips any ticker not in
  // tickerMetrics, exactly as computePortfolioER does.
  const diversification = computeDiversificationMetrics({
    positions,
    tickerMetrics,
    etfCorrelations,
    windowDays: lookbackDays,
  });

  const adj = diversification.correlation_adjusted;
  const decomp =
    adj.total > 1e-9
      ? {
          market: adj.market_er / adj.total,
          sector: adj.sector_er / adj.total,
          subsector: adj.subsector_er / adj.total,
          residual: adj.residual_er / adj.total,
        }
      : {
          market: core.portfolioER.market,
          sector: core.portfolioER.sector,
          subsector: core.portfolioER.subsector,
          residual: core.portfolioER.residual,
        };
  const decompSystematic = decomp.market + decomp.sector + decomp.subsector;
  const highLayer = Math.max(decomp.market, decomp.sector, decomp.subsector) > 0.55;

  const driverScores: { label: string; value: number }[] = [
    { label: "market", value: decomp.market },
    { label: "sector", value: decomp.sector },
    { label: "subsector", value: decomp.subsector },
    { label: "residual", value: decomp.residual },
  ].sort((a, b) => b.value - a.value);
  const dominant_drivers = driverScores.slice(0, 3).map((d) => d.label);

  const top_exposures = perPositions.slice(0, 10).map((p) => ({
    ticker: p.ticker,
    weight: p.weight,
    l3_mkt_er: p.l3_mkt_er,
    l3_sec_er: p.l3_sec_er,
    l3_sub_er: p.l3_sub_er,
  }));

  // Shares sum to ~1, so systematic_risk_share == decompSystematic.
  const systematic_risk_share = decompSystematic;

  const body: CanonicalSnapshotResponse = {
    snapshot: {
      as_of: asOf || meta.data_as_of,
      lookback_trading_days: teoS.length,
      mode,
      benchmark: benchmark,
      positions: perPositions,
      variance_decomposition: {
        market: decomp.market,
        sector: decomp.sector,
        subsector: decomp.subsector,
        residual: decomp.residual,
        systematic: decompSystematic,
      },
      diversification,
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
      ...(timeSeriesCaveat ? { time_series_caveat: timeSeriesCaveat } : {}),
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

/**
 * Snapshot Architecture v3 — `type: "ticker"` shim.
 *
 * Delegates to `buildCanonicalPortfolioSnapshot` with a single-position
 * portfolio at weight 1.0, so the response shape (snapshot / time_behavior /
 * attribution / risk_summary) stays identical across both branches per the v3
 * spec. Augments `snapshot.ticker_meta` with sector/subsector/asset_type and
 * the active L3 factor list for the ticker.
 *
 * Null-guard: if `subsector_etf` is missing in the registry (per F.9 — 40 XLY
 * tickers don't have a subsector mapping yet), it falls back to `sector_etf`
 * for the factor list. The downstream computation already handles null
 * subsectors via `subsector_etf || sector_etf` semantics in the DAL.
 */
export async function buildCanonicalTickerSnapshot(input: {
  ticker: string;
  lookbackDays: number;
  mode: "frozen";
  benchmark: string | null;
}): Promise<
  { ok: true; body: CanonicalSnapshotResponse } | { ok: false; error: string; status: number; details?: unknown }
> {
  const { ticker, lookbackDays, mode, benchmark } = input;

  const symMap = await resolveSymbolsByTickers([ticker]);
  const symRec = symMap.get(ticker);
  if (!symRec) {
    return { ok: false, error: `Symbol not found for ticker ${ticker}`, status: 404 };
  }

  const portfolioResult = await buildCanonicalPortfolioSnapshot({
    positions: [{ ticker, weight: 1.0 }],
    lookbackDays,
    mode,
    benchmark,
  });
  if (!portfolioResult.ok) return portfolioResult;

  const sectorEtf = symRec.sector_etf || null;
  const subsectorEtf = symRec.subsector_etf || symRec.sector_etf || null;
  const factors = ["SPY"];
  if (sectorEtf && !factors.includes(sectorEtf)) factors.push(sectorEtf);
  if (subsectorEtf && !factors.includes(subsectorEtf)) factors.push(subsectorEtf);

  portfolioResult.body.snapshot.ticker_meta = {
    ticker: symRec.ticker,
    symbol: symRec.symbol,
    sector_etf: sectorEtf,
    subsector_etf: subsectorEtf,
    asset_type: symRec.asset_type || null,
    factors,
  };

  return { ok: true, body: portfolioResult.body };
}
