/**
 * Response contract for GET /api/fundamentals/{ticker} — LICENSING IS THE SPEC.
 *
 * The backing store's raw line items are EODHD-primary and are NOT cleared for
 * redistribution (EODHD Exhibit B; H.69 counsel question pending). Only derived
 * analytics plus Exhibit B(e) fields ship. This module is the single place that
 * decides what leaves the server:
 *
 * - `FUNDAMENTALS_ROW_ALLOWED_FIELDS` is a strict allowlist enforced by
 *   `sanitizeFundamentalsRow` on every row at the serialization boundary.
 * - `FUNDAMENTALS_HELD_BACK_FIELDS` names the raw planes that must never
 *   appear; a unit test fails if any of them ever shows up in a response row
 *   (tests/fundamentals-contract.test.ts).
 *
 * A held-back field may only move to the allowlist when it is promoted to
 * SEC-sourced (store `source` plane == 2 for that field) or counsel clears it.
 * Do NOT add fields here casually — this file is reviewed as a licensing gate.
 */

/** Fields cleared to ship: derived analytics + Exhibit B(e). Order = response order. */
export const FUNDAMENTALS_ROW_ALLOWED_FIELDS = [
  "period_end_date",
  "filed_date",
  "filed_date_source",
  // Derived margins/ratios (computed server-side; raw inputs stay internal)
  "gross_margin",
  "operating_margin",
  "roe_ttm",
  "roa_ttm",
  "leverage_ratio",
  "fcf_margin",
  // Our own derived analytics (ERM3 cascade betas + provenance)
  "beta_market",
  "beta_sector",
  "beta_subsector",
  "beta_source",
  // Cost-of-capital layer (H.89.1) — derived at read, never stored
  "rf_rate",
  "cost_of_equity",
  "cost_of_debt",
  "wacc",
  "economic_profit",
  // Exhibit B(e)
  "market_cap",
] as const;

export type FundamentalsRowField = (typeof FUNDAMENTALS_ROW_ALLOWED_FIELDS)[number];

/**
 * Raw vendor line items — HELD BACK pending SEC promotion or counsel clearance
 * (H.69 / EODHD Exhibit B). `earnings_surprise` and `book_value_per_share` are
 * parked gray pending counsel. No analyst/forecast fields exist in the store,
 * but they are listed so the contract test asserts their absence anyway.
 */
export const FUNDAMENTALS_HELD_BACK_FIELDS = [
  "revenue",
  "net_income",
  "ebitda",
  "eps_actual",
  "eps_estimate",
  "eps_diluted",
  "total_assets",
  "total_equity",
  "total_debt",
  "shares_outstanding_q",
  "cash_from_operations",
  "capital_expenditures",
  "interest_expense",
  // gray pending counsel
  "earnings_surprise",
  "book_value_per_share",
  // never in the store (no-investment-advice house rule) — asserted anyway
  "eps_forecast",
  "revenue_forecast",
  "analyst_rating",
  "target_price",
  "free_cash_flow",
] as const;

export interface FundamentalsRow {
  period_end_date: string;
  filed_date: string | null;
  filed_date_source: "exact" | "approx" | null;
  gross_margin: number | null;
  operating_margin: number | null;
  roe_ttm: number | null;
  roa_ttm: number | null;
  leverage_ratio: number | null;
  fcf_margin: number | null;
  beta_market: number | null;
  beta_sector: number | null;
  beta_subsector: number | null;
  beta_source: "none" | "in-universe" | "out-of-universe" | "post-delisting" | null;
  rf_rate: number | null;
  cost_of_equity: number | null;
  cost_of_debt: number | null;
  wacc: number | null;
  economic_profit: number | null;
  market_cap: number | null;
}

/**
 * Strict pick of allowlisted keys. Anything not on the allowlist — including a
 * raw plane that leaks into an internal row object by future refactor — is
 * dropped here. Missing allowlisted keys serialize as null so the row shape is
 * stable for clients.
 */
export function sanitizeFundamentalsRow(
  row: Record<string, unknown>,
): FundamentalsRow {
  const out: Record<string, unknown> = {};
  for (const key of FUNDAMENTALS_ROW_ALLOWED_FIELDS) {
    const v = row[key];
    out[key] = v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null : v;
  }
  return out as unknown as FundamentalsRow;
}

/**
 * Disclosures block returned on every response. Wording sourced from
 * ERM3/docs/MODEL_LIMITATIONS.md §fundamentals and the ds_fundamentals spec —
 * keep in sync with OPENAPI_SPEC.yaml `/fundamentals/{ticker}` description.
 */
export function buildFundamentalsDisclosures(params: {
  erp: number;
  tax_rate: number;
  as_of: string;
  rf_tenor: string;
}): Record<string, unknown> {
  return {
    realized_historical_only:
      "This endpoint surfaces only realized historical data. No forecasts, no analyst targets, no buy/sell signals.",
    coverage:
      "Coverage starts ~2009 for most filers; pre-2009 and small-cap or recently-IPO'd names are thin. Missing fields are null, not row-dropped.",
    point_in_time:
      "Rows are visible only where filed_date <= as_of. filed_date_source is 'exact' (vendor filing date) or 'approx' (period_end + 45 days, the 10-Q deadline, when the vendor date is missing).",
    conditional_beta_cost_of_equity:
      "beta_market is a short-half-life conditional market beta, not a textbook long-run CAPM beta. For defensive names it can be low or negative, so cost_of_equity can fall below the risk-free rate. That is a property of the conditional beta, not an error.",
    wacc_book_weights:
      "WACC uses BOOK-value weights (balance-sheet equity and debt). Market-value weights are the textbook convention; compute them yourself if you have market-cap access.",
    ttm_convention:
      "TTM aggregates sum flows over the trailing 4 reported quarters; stock quantities are point-in-time (ROE denominator uses the trailing-4-quarter average equity). Ratios need 4 finite quarters or they are null.",
    derived_only:
      "Raw vendor line items (revenue, net income, EPS, balance-sheet levels) are not redistributable and are not included. gross_margin and operating_margin are null pending store inputs. market_cap is a current snapshot, not point-in-time per quarter.",
    parameters: {
      as_of: params.as_of,
      erp: params.erp,
      erp_note:
        "Equity risk premium is always caller-supplied (default 0.05); no ERP opinion is stored.",
      tax_rate: params.tax_rate,
      tax_rate_note: "Tax rate applied to the WACC debt shield (default 0.21).",
      rf_tenor: params.rf_tenor,
      rf_tenor_note:
        "rf_rate is the Treasury constant-maturity yield at the selected tenor (rf_tenor: 3m|1y|2y|5y|10y|30y), sampled at the last observation on or before each quarter's period end. Default 10y — the valuation convention (equities are long-duration claims; standard ERPs are measured over long-term government bonds). A short tenor (3m/1y) should be paired with a bill-basis ERP (historically ~1-2pp higher than the long-bond ERP) or cost of capital is understated.",
    },
  };
}
