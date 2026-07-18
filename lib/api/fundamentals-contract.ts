/**
 * Response contract for GET /api/fundamentals/{ticker} — LICENSING IS THE SPEC.
 *
 * The backing store's raw line items are vendor-primary, so they stay internal.
 * What ships is derived analytics, the Exhibit B(e) fields, and SEC-sourced
 * facts gated per cell. This module is the single place that decides what
 * leaves the server:
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
  // SEC-sourced raw line items, gated PER CELL by secCellValue (H.69 per-row rule).
  "sec_facts",
  // Derived margins/ratios (computed server-side; raw inputs stay internal)
  "gross_margin",
  "operating_margin",
  "roe_ttm",
  "roa_ttm",
  "leverage_ratio",
  "fcf_margin",
  // Capital-return ratios (Phase 2) — derived from SEC-served TTM flows
  "payout_ratio",
  "retention_ratio",
  "buyback_ratio",
  "total_payout_ratio",
  "sustainable_growth",
  // Equity bridge (Phase 3) — the residual that closes the roll-forward, + what backed it
  "equity_bridge_residual",
  "equity_bridge_inputs",
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
 * Fields that must never appear as a FLAT raw plane on a response row.
 *
 * The SEC-sourced raw line items in `SEC_FACT_CONCEPTS` are no longer here: they ship inside
 * `sec_facts`, gated per cell by `secCellValue`, so a flat `revenue` key must still never appear
 * (the test asserts this) while `sec_facts.revenue` may — but only for SEC cells.
 *
 * These remain hard-held-back as flat keys:
 *  - EODHD-only levels with no clean SEC exposure yet: `ebitda` (not an XBRL concept),
 *    `eps_actual`, `total_debt` (a roll-up), `shares_outstanding_q` (lives in the shares layer).
 *  - `eps_estimate` and forecast/rating fields — no-investment-advice house rule (also in
 *    SEC_FACT_DENY so they cannot enter sec_facts either).
 *  - `earnings_surprise`, `book_value_per_share` — withheld out of caution; they may only move
 *    to the allowlist via the SEC-promotion rule above.
 */
export const FUNDAMENTALS_HELD_BACK_FIELDS = [
  // EODHD-only, no clean SEC raw exposure
  "ebitda",
  "eps_actual",
  "total_debt",
  "shares_outstanding_q",
  // house rule — analyst/forecast, never shipped (also denied inside sec_facts)
  "eps_estimate",
  "eps_forecast",
  "revenue_forecast",
  "analyst_rating",
  "target_price",
  // withheld out of caution — promote only via the SEC-sourced rule
  "earnings_surprise",
  "book_value_per_share",
  // derived, exposed only as the computed `fcf_margin` ratio, never as a raw flat plane
  "free_cash_flow",
] as const;

/**
 * SEC-sourced raw line items — the H.69 per-ROW rule made operable.
 *
 * A raw vendor line item is not redistributable (EODHD Exhibit B). But the store now serves many
 * cells from SEC XBRL (public), marked per cell by a `{concept}_source` plane
 * (0=none, 1=EODHD, 2=SEC us-gaap, 3=SEC ifrs). This block ships the raw value ONLY for cells
 * whose SERVING row is SEC — regardless of the concept's internal promotion status, because even
 * an EODHD-primary concept (e.g. interest_expense) is SEC-served on cells EODHD left empty.
 *
 * The gate is per CELL and lives in the DAL: a value reaches `sec_facts` only after
 * `secCellValue` has confirmed its source is SEC. `sec_facts` therefore CANNOT contain an EODHD
 * value by construction. That is the licensing invariant, asserted in the contract test.
 *
 * `eps_estimate` and any forecast/rating field are DENIED here unconditionally (no-investment-
 * advice house rule) even though they never carry a SEC source today.
 */
export const SEC_FACT_CONCEPTS = [
  // income statement
  "revenue", "net_income", "operating_income", "pretax_income", "income_tax_expense",
  "total_costs_and_expenses", "profit_loss", "nci_income", "eps_diluted", "interest_expense",
  // balance sheet
  "total_assets", "total_equity", "total_liabilities", "liabilities_and_equity",
  "retained_earnings", "accumulated_oci",
  // cash flow
  "cash_from_operations", "capital_expenditures", "cash_from_investing", "cash_from_financing",
  "fx_effect_on_cash", "change_in_cash",
  // capital management
  "dividends_paid", "dividends_declared", "dividends_preferred", "share_repurchases",
  "share_issuance", "share_based_comp",
  // WACC product legs (H.89.12 — SEC-promoted; EODHD-primary cells stay internal)
  "interest_paid", "cash_and_equivalents", "short_term_investments", "preferred_equity",
] as const;
export type SecFactConcept = (typeof SEC_FACT_CONCEPTS)[number];

/** Concepts that must NEVER ship raw, whatever their source (house rule). */
export const SEC_FACT_DENY = new Set<string>([
  "eps_estimate", "eps_forecast", "revenue_forecast", "analyst_rating", "target_price",
]);

export type SecFactSource = "us_gaap" | "ifrs";
export interface SecFact {
  value: number;
  /** basis of the serving SEC row: us-gaap or FX-converted ifrs-full. */
  source: SecFactSource;
}
/** Per-period map of only the concepts SEC-served for that cell. Absent key = not SEC-served. */
export type SecFacts = Partial<Record<SecFactConcept, SecFact>>;

/**
 * The per-cell licensing gate. Returns a SecFact iff the source plane says SEC (2=us-gaap,
 * 3=ifrs) and the value is finite and the concept is not denied. Any other case → undefined,
 * so the concept is simply absent from `sec_facts`. This is the ONLY door a raw value passes
 * through; keep it that way.
 */
export function secCellValue(
  concept: string,
  value: number | null | undefined,
  sourcePlane: number | null | undefined,
): SecFact | undefined {
  if (SEC_FACT_DENY.has(concept)) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (sourcePlane === 2) return { value, source: "us_gaap" };
  if (sourcePlane === 3) return { value, source: "ifrs" };
  return undefined; // 0/1/null → EODHD or empty → not redistributable
}

/**
 * Equity-bridge components, in the store's bit order (ERM3 fundamentals_concepts.BRIDGE_COMPONENTS).
 * `equity_bridge_inputs` is a bitmask; bit i is set when component i backed that period's residual.
 * MUST match the Python order exactly — bit 0 = net_income, …, bit 6 = share_based_comp.
 */
export const EQUITY_BRIDGE_COMPONENTS = [
  "net_income",          // +1, bit 0
  "accumulated_oci",     // +1 (as a DELTA), bit 1
  "dividends_declared",  // -1, bit 2
  "dividends_preferred", // -1, bit 3
  "share_repurchases",   // -1, bit 4
  "share_issuance",      // +1, bit 5
  "share_based_comp",    // +1, bit 6
] as const;

/** Decode the bitmask into the component names that were present. Absent bit = MISSING that term. */
export function decodeEquityBridgeInputs(mask: number | null | undefined): string[] {
  if (typeof mask !== "number" || !Number.isFinite(mask)) return [];
  const m = Math.round(mask);
  return EQUITY_BRIDGE_COMPONENTS.filter((_c, i) => (m & (1 << i)) !== 0);
}

export interface FundamentalsRow {
  period_end_date: string;
  filed_date: string | null;
  filed_date_source: "exact" | "approx" | null;
  /** SEC-sourced raw line items for this period (only SEC-served concepts appear). */
  sec_facts: SecFacts;
  gross_margin: number | null;
  operating_margin: number | null;
  roe_ttm: number | null;
  roa_ttm: number | null;
  leverage_ratio: number | null;
  fcf_margin: number | null;
  payout_ratio: number | null;
  retention_ratio: number | null;
  buyback_ratio: number | null;
  total_payout_ratio: number | null;
  sustainable_growth: number | null;
  /** The plug that closes E_t - E_{t-1} = modelled + residual. See the disclosure. */
  equity_bridge_residual: number | null;
  /** Which components backed the residual; a MISSING one means an unattributed movement. */
  equity_bridge_inputs: string[];
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
    if (key === "sec_facts") {
      // Defense in depth: even if a caller hands us a raw sec_facts, re-run every entry through
      // the gate so a non-SEC or denied value cannot survive to serialization. The DAL already
      // gated on read; this is the belt to that suspenders.
      out[key] = sanitizeSecFacts(v);
      continue;
    }
    if (key === "equity_bridge_inputs") {
      // Array-valued: keep an array of known component names, default []. Never null (the shape
      // is a stable list a consumer can iterate).
      const known = new Set<string>(EQUITY_BRIDGE_COMPONENTS);
      out[key] = Array.isArray(v) ? v.filter((x) => typeof x === "string" && known.has(x)) : [];
      continue;
    }
    out[key] = v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null : v;
  }
  return out as unknown as FundamentalsRow;
}

/** Re-assert the licensing invariant: keep only finite SEC-basis, non-denied entries. */
export function sanitizeSecFacts(v: unknown): SecFacts {
  const out: SecFacts = {};
  if (!v || typeof v !== "object") return out;
  const allowed = new Set<string>(SEC_FACT_CONCEPTS);
  for (const [concept, fact] of Object.entries(v as Record<string, unknown>)) {
    if (!allowed.has(concept) || SEC_FACT_DENY.has(concept)) continue;
    if (!fact || typeof fact !== "object") continue;
    const { value, source } = fact as { value?: unknown; source?: unknown };
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (source !== "us_gaap" && source !== "ifrs") continue;
    out[concept as SecFactConcept] = { value, source };
  }
  return out;
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
    valuation_beta_cost_of_equity:
      "beta_market is the long-window (~60-month monthly, Vasicek-shrunk) valuation beta from ds_valuation_betas — the CFO-grade CAPM input for cost of equity / WACC / economic profit. It is NOT the short-half-life hedging beta on the risk surface.",
    wacc_book_weights:
      "WACC uses BOOK-value weights (balance-sheet equity and debt). Market-value weights are the textbook convention; compute them yourself if you have market-cap access. If book debt is positive but cost_of_debt cannot be formed (missing or non-positive TTM interest expense), wacc is null — never a partial equity-only fraction of ke.",
    ttm_convention:
      "TTM aggregates sum flows over the trailing 4 reported quarters; stock quantities are point-in-time (ROE denominator uses the trailing-4-quarter average equity). Ratios need 4 finite quarters or they are null.",
    equity_bridge:
      "equity_bridge_residual makes the equity roll-forward an identity BY CONSTRUCTION: total_equity_t - total_equity_{t-1} = net_income + d(accumulated_oci) - dividends_declared - dividends_preferred - share_repurchases + share_issuance + share_based_comp + equity_bridge_residual. It is a PLUG, not a measured line, and is frequently large: it absorbs equity-statement movements not captured by the listed components (treasury purchases at cost, noncontrolling-interest movements, cumulative-effect adjustments, conversions, spin-offs) AND any listed component the filer did not tag. equity_bridge_inputs names the components that were present; a term MISSING from that list means its movement is inside the residual, not that it was zero (e.g. a filer that does not tag dividends_declared has its dividends in the residual). Treat this bridge as a disclosed decomposition, not truth; for modelling, anchor on retained_earnings. Null on a symbol's first reported period.",
    capital_return_ratios:
      "payout_ratio, retention_ratio (=1-payout, the reinvestment-rate proxy), buyback_ratio, total_payout_ratio, and sustainable_growth (=retention*roe_ttm) are TTM. Dividend basis is CASH PAID (dividends_paid) — the shareholder-return measure, and denser than declared (many filers, e.g. Apple and Exxon, tag only paid). For the EXACT retained-earnings roll-forward use dividends_declared, exposed raw in sec_facts: retention_ratio here is cash-basis and equals accrual retention up to declaration-vs-payment timing. All are null when trailing-4-quarter net income is <= 0 — a payout on non-positive earnings is not meaningful, not zero. total_payout_ratio (dividends + buybacks) can exceed 1 in a heavy-buyback year and is more volatile than payout_ratio.",
    sec_facts_provenance:
      "sec_facts carries RAW line items only for cells whose serving value is SEC XBRL (public, redistributable), tagged us_gaap or ifrs. A concept is absent for a period when that cell is EODHD-sourced (not redistributable) or empty. Coverage varies by concept and filer: income-statement/balance-sheet levels are ~30-50% SEC on large caps; cash-flow and capital-management items are near-100% SEC where reported. Values are as-originally-reported (earliest filing), not restated.",
    sec_facts_definitions:
      "Bank/insurer revenue is the CONSOLIDATED top line (interest+dividend income + noninterest income for banks), not the parent-company (Schedule I) figure. This can differ materially from a vendor total; for mortgage REITs it excludes investment gains. total_equity is PARENT-attributable. dividends_declared (accrual, drives retained earnings) and dividends_paid (cash) are distinct. All cash flows are POSITIVE = cash out.",
    market_cap_note:
      "market_cap is a current snapshot (Exhibit B(e)), not point-in-time per quarter. gross_margin and operating_margin ratios are null pending store inputs.",
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
