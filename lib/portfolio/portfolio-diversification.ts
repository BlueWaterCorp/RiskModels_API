/**
 * Portfolio diversification metrics — variance-space quadratic adjustment.
 *
 * Pure function: no DAL calls, receives pre-fetched data.
 * All values in variance-fraction space (same units as l3_*_er).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface DiversificationTickerMetrics {
  l3_mkt_er: number | null;
  l3_sec_er: number | null;
  l3_sub_er: number | null;
  l3_res_er: number | null;
  sector_etf: string | null;
  subsector_etf: string | null;
}

export interface CorrelationMatrix {
  etfs: string[];
  R: number[][];
}

export interface DiversificationInput {
  positions: { ticker: string; weight: number }[];
  tickerMetrics: Map<string, DiversificationTickerMetrics>;
  etfCorrelations: {
    sector: CorrelationMatrix;
    subsector: CorrelationMatrix;
  };
  windowDays: number;
}

export interface DiversificationLayer {
  layer: "market" | "sector" | "subsector" | "residual";
  naive_er: number;
  adjusted_er: number;
  adjustment_er: number;
  multiplier: number | null;
  unique_etfs?: number;
}

export interface DiversificationResult {
  window_days: number;
  method: string;
  naive_pws: {
    market_er: number;
    sector_er: number;
    subsector_er: number;
    residual_er: number;
    total: number;
  };
  correlation_adjusted: {
    market_er: number;
    sector_er: number;
    subsector_er: number;
    residual_er: number;
    total: number;
  };
  diversification_credit: {
    market: number;
    sector: number;
    subsector: number;
    residual: number;
    total: number;
  };
  layers: DiversificationLayer[];
  warnings: string[];
  _explanation: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute diversification multiplier: (u'Ru) / (sum |u_i|)^2.
 * Denominator is the perfectly-correlated case (R = all 1s), so
 * multiplier = 1.0 when all correlations are 1, < 1.0 when
 * imperfect correlations reduce portfolio variance.
 * Clamped to [0, 1].
 */
function diversificationMultiplier(u: number[], R: number[][]): number {
  const n = u.length;
  let uRu = 0;
  let sumAbsU = 0;
  for (let i = 0; i < n; i++) {
    sumAbsU += Math.abs(u[i]);
    for (let j = 0; j < n; j++) {
      uRu += u[i] * R[i][j] * u[j];
    }
  }
  const perfectlyCorrelated = sumAbsU * sumAbsU;
  if (perfectlyCorrelated < 1e-15) return 1;
  return Math.max(0, Math.min(1, uRu / perfectlyCorrelated));
}

function buildExposureVector(
  positions: { ticker: string; weight: number }[],
  tickerMetrics: Map<string, DiversificationTickerMetrics>,
  erKey: "l3_sec_er" | "l3_sub_er" | "l3_mkt_er",
  etfKey: "sector_etf" | "subsector_etf" | null,
  etfList: string[],
): { u: number[]; warnings: string[] } {
  const etfIndex = new Map(etfList.map((e, i) => [e, i]));
  const u = new Array(etfList.length).fill(0);
  const warnings: string[] = [];

  for (const { ticker, weight } of positions) {
    const m = tickerMetrics.get(ticker);
    if (!m) continue;

    const er = m[erKey];
    if (er == null || !Number.isFinite(er)) continue;

    if (etfKey === null) {
      if (etfList.length === 1) u[0] += weight * er;
      continue;
    }

    const etf = m[etfKey];
    if (!etf) {
      warnings.push(`${ticker} missing ${etfKey}`);
      continue;
    }

    const idx = etfIndex.get(etf);
    if (idx === undefined) {
      warnings.push(`${ticker} ${etfKey}=${etf} not in correlation matrix`);
      continue;
    }

    u[idx] += weight * er;
  }

  return { u, warnings };
}

function makeLayer(
  layer: DiversificationLayer["layer"],
  naive: number,
  adjusted: number,
  uniqueEtfs?: number,
): DiversificationLayer {
  const adjustment = naive - adjusted;
  const multiplier = naive > 1e-10 ? adjusted / naive : null;
  return {
    layer,
    naive_er: round6(naive),
    adjusted_er: round6(adjusted),
    adjustment_er: round6(adjustment),
    multiplier: multiplier != null ? round4(multiplier) : null,
    ...(uniqueEtfs != null ? { unique_etfs: uniqueEtfs } : {}),
  };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function computeDiversificationMetrics(
  input: DiversificationInput,
): DiversificationResult {
  const { positions, tickerMetrics, etfCorrelations, windowDays } = input;
  const warnings: string[] = [];

  // Naive: weighted sum per layer (same as computePortfolioER)
  let naiveMarket = 0;
  let naiveSector = 0;
  let naiveSubsector = 0;
  let naiveResidual = 0;

  for (const { ticker, weight } of positions) {
    const m = tickerMetrics.get(ticker);
    if (!m) continue;
    naiveMarket += weight * (m.l3_mkt_er ?? 0);
    naiveSector += weight * (m.l3_sec_er ?? 0);
    naiveSubsector += weight * (m.l3_sub_er ?? 0);
    naiveResidual += weight * (m.l3_res_er ?? 0);
  }

  // Market: single factor (SPY) — no cross-ETF diversification possible.
  // adjusted = naive (all positions share the same market factor).
  const adjMarket = naiveMarket;

  // Sector: diversification multiplier from cross-sector ETF correlations
  const { u: uSec, warnings: wSec } = buildExposureVector(
    positions, tickerMetrics, "l3_sec_er", "sector_etf", etfCorrelations.sector.etfs,
  );
  warnings.push(...wSec);
  const adjSector = naiveSector * diversificationMultiplier(uSec, etfCorrelations.sector.R);

  // Subsector: diversification multiplier from cross-subsector ETF correlations
  const { u: uSub, warnings: wSub } = buildExposureVector(
    positions, tickerMetrics, "l3_sub_er", "subsector_etf", etfCorrelations.subsector.etfs,
  );
  warnings.push(...wSub);
  const adjSubsector = naiveSubsector * diversificationMultiplier(uSub, etfCorrelations.subsector.R);

  // Residual: concentration multiplier — HHI of ER-weighted positions.
  // multiplier = (sum w_i^2 * res_er_i) / (sum w_i * res_er_i) when naive > 0.
  // Equals 1/N for equal-weight equal-ER portfolio, 1.0 for single position.
  let residualConcentration = 0;
  for (const { ticker, weight } of positions) {
    const m = tickerMetrics.get(ticker);
    if (!m) continue;
    residualConcentration += weight * weight * (m.l3_res_er ?? 0);
  }
  const residualMultiplier = naiveResidual > 1e-15 ? Math.min(1, residualConcentration / naiveResidual) : 1;
  const adjResidual = naiveResidual * residualMultiplier;

  const layers: DiversificationLayer[] = [
    makeLayer("market", naiveMarket, adjMarket),
    makeLayer("sector", naiveSector, adjSector, etfCorrelations.sector.etfs.length),
    makeLayer("subsector", naiveSubsector, adjSubsector, etfCorrelations.subsector.etfs.length),
    makeLayer("residual", naiveResidual, adjResidual),
  ];

  const naiveTotal = naiveMarket + naiveSector + naiveSubsector + naiveResidual;
  const adjTotal = adjMarket + adjSector + adjSubsector + adjResidual;

  return {
    window_days: windowDays,
    method: "variance_space_quadratic",
    naive_pws: {
      market_er: round6(naiveMarket),
      sector_er: round6(naiveSector),
      subsector_er: round6(naiveSubsector),
      residual_er: round6(naiveResidual),
      total: round6(naiveTotal),
    },
    correlation_adjusted: {
      market_er: round6(adjMarket),
      sector_er: round6(adjSector),
      subsector_er: round6(adjSubsector),
      residual_er: round6(adjResidual),
      total: round6(adjTotal),
    },
    diversification_credit: {
      market: round6(Math.max(0, naiveMarket - adjMarket)),
      sector: round6(Math.max(0, naiveSector - adjSector)),
      subsector: round6(Math.max(0, naiveSubsector - adjSubsector)),
      residual: round6(Math.max(0, naiveResidual - adjResidual)),
      total: round6(Math.max(0, naiveTotal - adjTotal)),
    },
    layers,
    warnings,
    _explanation:
      "Sector and subsector layers apply a diversification multiplier (u'Ru)/(u'u) " +
      "derived from realized correlations between the underlying ETFs, scaled to naive ER. " +
      "Market layer has no diversification credit (single shared factor). " +
      "Residual uses a concentration multiplier reflecting position-count diversification.",
  };
}
