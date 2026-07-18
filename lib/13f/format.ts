/**
 * Filer formatting — converts FilerRow + FilerPortfolioLatestRow into the
 * single-call response shape for `GET /api/13f/filers/{bw_filer_id}`. Mirror
 * of `lib/funds/format.ts` for funds.
 *
 * Cohort axis differs from funds: filer_type × aum_tier (not equity_style_9box).
 * No NAV is ever surfaced for filers — by design, not a gap.
 */

import type {
  FilerRow,
  FilerPortfolioLatestRow,
} from "@/lib/dal/filers-engine";

export interface FilerMetricsResponse {
  bw_filer_id: string;
  cik: string | null;
  name: string | null;
  filer_type: string | null;
  filer_subtype: string | null;
  aum_tier: string | null;
  style_label: string | null;
  country: string | null;
  status: string | null;
  n_funds_managed: number | null;
  // Latest snapshot lineage
  report_date: string | null;
  filing_date: string | null;
  extracted_at: string | null;
  // Returns (NULL until Phase 2)
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_style_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  // Diagnostics
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
  // AUM
  total_aum_usd: number | null;
  aum_in_erm3: number | null;
  // ERM3 coverage diagnostics
  n_holdings_in_erm3: number | null;
  effective_n_in_erm3: number | null;
  coverage_in_erm3: number | null;
  // Portfolio-derived style attribution
  portfolio_9box_distribution: Record<string, number> | null;
  dominant_9box: string | null;
  portfolio_style_hhi: number | null;
  effective_n_styles: number | null;
  // Modelability
  is_modelable: boolean | null;
  // Lineage
  model_version: string | null;
  factor_set_id: string | null;
}

export function formatFilerMetrics(
  filer: FilerRow,
  latest: FilerPortfolioLatestRow | null,
): FilerMetricsResponse {
  return {
    bw_filer_id: filer.bw_filer_id,
    cik: filer.cik,
    name: filer.name,
    filer_type: filer.filer_type,
    filer_subtype: filer.filer_subtype,
    aum_tier: filer.aum_tier,
    style_label: filer.style_label,
    country: filer.country,
    status: filer.status,
    n_funds_managed: filer.n_funds_managed,
    report_date: latest?.report_date ?? filer.latest_report_date,
    filing_date: latest?.filing_date ?? filer.latest_filing_date,
    extracted_at: latest?.extracted_at ?? filer.latest_extracted_at,
    portfolio_gross_return: latest?.portfolio_gross_return ?? null,
    portfolio_market_return: latest?.portfolio_market_return ?? null,
    portfolio_sector_return: latest?.portfolio_sector_return ?? null,
    portfolio_subsector_return: latest?.portfolio_subsector_return ?? null,
    portfolio_style_return: latest?.portfolio_style_return ?? null,
    portfolio_idiosyncratic_return: latest?.portfolio_idiosyncratic_return ?? null,
    identity_residual: latest?.identity_residual ?? null,
    weight_sum: latest?.weight_sum ?? null,
    n_holdings_active: latest?.n_holdings_active ?? null,
    effective_n: latest?.effective_n ?? null,
    top10_weight_sum: latest?.top10_weight_sum ?? null,
    total_aum_usd: latest?.total_aum_usd ?? filer.latest_aum_usd,
    aum_in_erm3: latest?.aum_in_erm3 ?? null,
    n_holdings_in_erm3: latest?.n_holdings_in_erm3 ?? null,
    effective_n_in_erm3: latest?.effective_n_in_erm3 ?? null,
    coverage_in_erm3: latest?.coverage_in_erm3 ?? null,
    portfolio_9box_distribution: latest?.portfolio_9box_distribution ?? null,
    dominant_9box: latest?.dominant_9box ?? null,
    portfolio_style_hhi: latest?.portfolio_style_hhi ?? null,
    effective_n_styles: latest?.effective_n_styles ?? null,
    is_modelable: latest?.is_modelable ?? null,
    model_version: latest?.model_version ?? null,
    factor_set_id: latest?.factor_set_id ?? null,
  };
}
