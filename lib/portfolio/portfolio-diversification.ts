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
  R: Array<Array<number | null>>;
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
  naive_er: number | null;
  adjusted_er: number | null;
  adjustment_er: number | null;
  multiplier: number | null;
  unique_etfs?: number;
}

export interface DiversificationResult {
  window_days: number;
  method: string;
  naive_pws: {
    market_er: number | null;
    sector_er: number | null;
    subsector_er: number | null;
    residual_er: number | null;
    total: number | null;
  };
  correlation_adjusted: {
    market_er: number | null;
    sector_er: number | null;
    subsector_er: number | null;
    residual_er: number | null;
    total: number | null;
  };
  diversification_credit: {
    market: number | null;
    sector: number | null;
    subsector: number | null;
    residual: number | null;
    total: number | null;
  };
  er_coverage: number;
  names_covered: number;
  names_total: number;
  aggregation: "covered_weights_not_renormalized";
  data_quality_flags: string[];
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
function diversificationMultiplier(u: number[], R: Array<Array<number | null>>): number | null {
  const n = u.length;
  let uRu = 0;
  let sumAbsU = 0;
  for (let i = 0; i < n; i++) {
    sumAbsU += Math.abs(u[i]);
    for (let j = 0; j < n; j++) {
      const rho = R[i]?.[j];
      if (rho == null || !Number.isFinite(rho)) return null;
      uRu += u[i] * rho * u[j];
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
  naive: number | null,
  adjusted: number | null,
  uniqueEtfs?: number,
): DiversificationLayer {
  const adjustment = naive != null && adjusted != null ? naive - adjusted : null;
  const multiplier = naive != null && adjusted != null && naive > 1e-10 ? adjusted / naive : null;
  return {
    layer,
    naive_er: naive == null ? null : round6(naive),
    adjusted_er: adjusted == null ? null : round6(adjusted),
    adjustment_er: adjustment == null ? null : round6(adjustment),
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
  let coveredAbsWeight = 0;
  const totalAbsWeight = positions.reduce((sum, position) => sum + Math.abs(position.weight), 0);
  const coveredPositions = positions.filter(({ ticker, weight }) => {
    const m = tickerMetrics.get(ticker);
    const complete = !!m &&
      m.l3_mkt_er != null && Number.isFinite(m.l3_mkt_er) &&
      m.l3_sec_er != null && Number.isFinite(m.l3_sec_er) &&
      m.l3_sub_er != null && Number.isFinite(m.l3_sub_er) &&
      m.l3_res_er != null && Number.isFinite(m.l3_res_er);
    if (complete) coveredAbsWeight += Math.abs(weight);
    return complete;
  });

  for (const { ticker, weight } of coveredPositions) {
    const m = tickerMetrics.get(ticker)!;
    naiveMarket += weight * m.l3_mkt_er!;
    naiveSector += weight * m.l3_sec_er!;
    naiveSubsector += weight * m.l3_sub_er!;
    naiveResidual += weight * m.l3_res_er!;
  }
  const hasCoverage = coveredPositions.length > 0;
  const erCoverage = totalAbsWeight > 0 ? coveredAbsWeight / totalAbsWeight : 0;
  const dataQualityFlags: string[] = erCoverage < 1 ? ["portfolio_er_coverage_incomplete"] : [];

  // Market: single factor (SPY) — no cross-ETF diversification possible.
  // adjusted = naive (all positions share the same market factor).
  const adjMarket = hasCoverage ? naiveMarket : null;

  // Sector: diversification multiplier from cross-sector ETF correlations
  const { u: uSec, warnings: wSec } = buildExposureVector(
    coveredPositions, tickerMetrics, "l3_sec_er", "sector_etf", etfCorrelations.sector.etfs,
  );
  warnings.push(...wSec);
  const sectorMultiplier = diversificationMultiplier(uSec, etfCorrelations.sector.R);
  const adjSector = hasCoverage && sectorMultiplier != null ? naiveSector * sectorMultiplier : null;
  if (hasCoverage && sectorMultiplier == null) dataQualityFlags.push("sector_correlation_incomplete");

  // Subsector: diversification multiplier from cross-subsector ETF correlations
  const { u: uSub, warnings: wSub } = buildExposureVector(
    coveredPositions, tickerMetrics, "l3_sub_er", "subsector_etf", etfCorrelations.subsector.etfs,
  );
  warnings.push(...wSub);
  const subsectorMultiplier = diversificationMultiplier(uSub, etfCorrelations.subsector.R);
  const adjSubsector = hasCoverage && subsectorMultiplier != null ? naiveSubsector * subsectorMultiplier : null;
  if (hasCoverage && subsectorMultiplier == null) dataQualityFlags.push("subsector_correlation_incomplete");

  // Residual: concentration multiplier — HHI of ER-weighted positions.
  // multiplier = (sum w_i^2 * res_er_i) / (sum w_i * res_er_i) when naive > 0.
  // Equals 1/N for equal-weight equal-ER portfolio, 1.0 for single position.
  let residualConcentration = 0;
  for (const { ticker, weight } of coveredPositions) {
    const m = tickerMetrics.get(ticker)!;
    residualConcentration += weight * weight * m.l3_res_er!;
  }
  const residualMultiplier = naiveResidual > 1e-15 ? Math.min(1, residualConcentration / naiveResidual) : 1;
  const adjResidual = hasCoverage ? naiveResidual * residualMultiplier : null;

  const layers: DiversificationLayer[] = [
    makeLayer("market", hasCoverage ? naiveMarket : null, adjMarket),
    makeLayer("sector", hasCoverage ? naiveSector : null, adjSector, etfCorrelations.sector.etfs.length),
    makeLayer("subsector", hasCoverage ? naiveSubsector : null, adjSubsector, etfCorrelations.subsector.etfs.length),
    makeLayer("residual", hasCoverage ? naiveResidual : null, adjResidual),
  ];

  const naiveTotal = hasCoverage ? naiveMarket + naiveSector + naiveSubsector + naiveResidual : null;
  const adjTotal =
    adjMarket != null && adjSector != null && adjSubsector != null && adjResidual != null
      ? adjMarket + adjSector + adjSubsector + adjResidual
      : null;
  const credit = (naive: number | null, adjusted: number | null) =>
    naive != null && adjusted != null ? round6(Math.max(0, naive - adjusted)) : null;

  return {
    window_days: windowDays,
    method: "variance_space_quadratic",
    naive_pws: {
      market_er: hasCoverage ? round6(naiveMarket) : null,
      sector_er: hasCoverage ? round6(naiveSector) : null,
      subsector_er: hasCoverage ? round6(naiveSubsector) : null,
      residual_er: hasCoverage ? round6(naiveResidual) : null,
      total: naiveTotal == null ? null : round6(naiveTotal),
    },
    correlation_adjusted: {
      market_er: adjMarket == null ? null : round6(adjMarket),
      sector_er: adjSector == null ? null : round6(adjSector),
      subsector_er: adjSubsector == null ? null : round6(adjSubsector),
      residual_er: adjResidual == null ? null : round6(adjResidual),
      total: adjTotal == null ? null : round6(adjTotal),
    },
    diversification_credit: {
      market: credit(hasCoverage ? naiveMarket : null, adjMarket),
      sector: credit(hasCoverage ? naiveSector : null, adjSector),
      subsector: credit(hasCoverage ? naiveSubsector : null, adjSubsector),
      residual: credit(hasCoverage ? naiveResidual : null, adjResidual),
      total: credit(naiveTotal, adjTotal),
    },
    er_coverage: round4(erCoverage),
    names_covered: coveredPositions.length,
    names_total: positions.length,
    aggregation: "covered_weights_not_renormalized",
    data_quality_flags: dataQualityFlags,
    layers,
    warnings,
    _explanation:
      "Sector and subsector layers apply a diversification multiplier (u'Ru)/(u'u) " +
      "derived from realized correlations between the underlying ETFs, scaled to naive ER. " +
      "Market layer has no diversification credit (single shared factor). " +
      "Residual uses a concentration multiplier reflecting position-count diversification. " +
      "Names missing any ER layer are excluded and covered weights are not renormalized; er_coverage uses absolute portfolio weight.",
  };
}
