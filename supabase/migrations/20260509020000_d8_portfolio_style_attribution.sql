-- D.8 portfolio style attribution + filer modelability
--
-- Adds symmetric columns to public.funds_latest and public.filer_portfolios_latest
-- so the same downstream logic works on both universes:
--
--   - portfolio_9box_distribution     JSONB   per-cell weights, sums to 1.0 over in-ERM3 portion
--   - dominant_9box                   TEXT    argmax cell label
--   - portfolio_style_hhi             REAL    Σ wᵢ² on renormalized in-ERM3 cell weights ([1/9, 1])
--   - effective_n_styles              REAL    1 / portfolio_style_hhi ([1, 9])
--   - coverage_in_erm3                REAL    Σ(in-ERM3 weights) / Σ(total weights)
--   - aum_in_erm3                     DOUBLE PRECISION   USD value of mapped positions
--   - n_holdings_in_erm3              INTEGER count of non-zero mapped positions
--   - effective_n_in_erm3             REAL    1 / Σ wᵢ² on renormalized in-ERM3 position weights
--   - is_modelable                    BOOLEAN modelability gate result (rendered as flag)
--
-- Adds n_funds_managed to public.filers (cross-link from filer_master ↔ fund_master
-- adviser_bw_filer_id; identifies advisers running both 13F and mutual funds).
--
-- Plan reference: BWMACRO/docs/13f_pipeline_plan.md §5, §6, §7.5
-- Backlog row: D.8.6
--
-- Purely additive. All new columns are NULLABLE — Phase 1 sync writers
-- populate them when the portfolio_style_attribution kernel ships; older
-- rows stay NULL until next sync.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. public.filers — add n_funds_managed
-- ---------------------------------------------------------------------------

ALTER TABLE public.filers
    ADD COLUMN IF NOT EXISTS n_funds_managed INTEGER;

COMMENT ON COLUMN public.filers.n_funds_managed IS
    'Count of mutual-fund series managed by this filer/adviser (cross-link via fund_master.adviser_bw_filer_id). Identifies advisers running both 13F and mutual-fund books.';


-- ---------------------------------------------------------------------------
-- 2. public.funds_latest — add 9 style-attribution columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.funds_latest
    ADD COLUMN IF NOT EXISTS portfolio_9box_distribution JSONB,
    ADD COLUMN IF NOT EXISTS dominant_9box               TEXT,
    ADD COLUMN IF NOT EXISTS portfolio_style_hhi         REAL,
    ADD COLUMN IF NOT EXISTS effective_n_styles          REAL,
    ADD COLUMN IF NOT EXISTS coverage_in_erm3            REAL,
    ADD COLUMN IF NOT EXISTS aum_in_erm3                 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS n_holdings_in_erm3          INTEGER,
    ADD COLUMN IF NOT EXISTS effective_n_in_erm3         REAL,
    ADD COLUMN IF NOT EXISTS is_modelable                BOOLEAN;

COMMENT ON COLUMN public.funds_latest.portfolio_9box_distribution IS
    'JSONB object mapping each 9-box cell label to its weight (renormalized to in-ERM3 subtotal). Sums to 1.0 over the in-ERM3 portion of the portfolio. Computed by portfolio_style_attribution kernel. Distinct from funds.equity_style_9box (Morningstar share-class derived) — this is portfolio-derived.';
COMMENT ON COLUMN public.funds_latest.dominant_9box IS
    'argmax of portfolio_9box_distribution — the single 9-box cell carrying the largest renormalized weight.';
COMMENT ON COLUMN public.funds_latest.portfolio_style_hhi IS
    'Herfindahl index on the 9 cell weights (renormalized to in-ERM3 subtotal). Range [1/9, 1]. Saved metric for downstream cohort dispersion / style-rotation analytics.';
COMMENT ON COLUMN public.funds_latest.effective_n_styles IS
    '1 / portfolio_style_hhi. Range [1, 9]. Effective number of style cells held — interpretable counterpart to portfolio_style_hhi.';
COMMENT ON COLUMN public.funds_latest.coverage_in_erm3 IS
    'Fraction of total portfolio weight that mapped to ERM3 universe (bw_sym_id). Reported, never used as an inclusion gate.';
COMMENT ON COLUMN public.funds_latest.aum_in_erm3 IS
    'USD value of mapped positions at latest report_date. Absolute-scale companion to coverage_in_erm3.';
COMMENT ON COLUMN public.funds_latest.n_holdings_in_erm3 IS
    'Count of non-zero mapped positions. Modelability gate input.';
COMMENT ON COLUMN public.funds_latest.effective_n_in_erm3 IS
    '1 / Σ wᵢ² on renormalized in-ERM3 position weights. Position-level diversification (distinct from effective_n_styles which is style-level).';
COMMENT ON COLUMN public.funds_latest.is_modelable IS
    'Result of fund/filer modelability gate — true if the in-ERM3 sub-portfolio carries signal value (sufficient breadth + dispersion + filing history).';


-- ---------------------------------------------------------------------------
-- 3. public.filer_portfolios_latest — same 9 columns (symmetric schema)
-- ---------------------------------------------------------------------------

ALTER TABLE public.filer_portfolios_latest
    ADD COLUMN IF NOT EXISTS portfolio_9box_distribution JSONB,
    ADD COLUMN IF NOT EXISTS dominant_9box               TEXT,
    ADD COLUMN IF NOT EXISTS portfolio_style_hhi         REAL,
    ADD COLUMN IF NOT EXISTS effective_n_styles          REAL,
    ADD COLUMN IF NOT EXISTS coverage_in_erm3            REAL,
    ADD COLUMN IF NOT EXISTS aum_in_erm3                 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS n_holdings_in_erm3          INTEGER,
    ADD COLUMN IF NOT EXISTS effective_n_in_erm3         REAL,
    ADD COLUMN IF NOT EXISTS is_modelable                BOOLEAN;

COMMENT ON COLUMN public.filer_portfolios_latest.portfolio_9box_distribution IS
    'JSONB object mapping each 9-box cell label to its weight (renormalized to in-ERM3 subtotal). Sums to 1.0 over the in-ERM3 portion. Filers have no Morningstar share-class 9-box — this is the only 9-box signal on the filer side.';
COMMENT ON COLUMN public.filer_portfolios_latest.dominant_9box IS
    'argmax of portfolio_9box_distribution.';
COMMENT ON COLUMN public.filer_portfolios_latest.portfolio_style_hhi IS
    'Herfindahl index on the 9 cell weights (renormalized to in-ERM3 subtotal). Saved for cohort dispersion / style-rotation analytics.';
COMMENT ON COLUMN public.filer_portfolios_latest.effective_n_styles IS
    '1 / portfolio_style_hhi. Effective number of style cells held.';
COMMENT ON COLUMN public.filer_portfolios_latest.coverage_in_erm3 IS
    'Fraction of total portfolio weight that mapped to ERM3 universe. Always reported. Filers legitimately run lower coverage than funds (global L/S, activists with EU exposure).';
COMMENT ON COLUMN public.filer_portfolios_latest.aum_in_erm3 IS
    'USD value of mapped positions at latest report_date.';
COMMENT ON COLUMN public.filer_portfolios_latest.n_holdings_in_erm3 IS
    'Count of non-zero mapped positions. Modelability gate input.';
COMMENT ON COLUMN public.filer_portfolios_latest.effective_n_in_erm3 IS
    'Position-level diversification on renormalized in-ERM3 weights. Modelability gate input.';
COMMENT ON COLUMN public.filer_portfolios_latest.is_modelable IS
    'Result of filer modelability gate. Drops the fund-side weight_coverage ≥ 0.85 criterion (too strict for global managers); requires n_holdings_in_erm3 ≥ 10 + effective_n_in_erm3 ≥ 5 + n_real_13f_filings ≥ 4 + filer_type filter.';


-- ---------------------------------------------------------------------------
-- 4. Helpful indexes for cohort + filter queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_funds_latest_dominant_9box
    ON public.funds_latest(dominant_9box);
CREATE INDEX IF NOT EXISTS idx_funds_latest_modelable
    ON public.funds_latest(is_modelable) WHERE is_modelable IS TRUE;

CREATE INDEX IF NOT EXISTS idx_filer_portfolios_dominant_9box
    ON public.filer_portfolios_latest(dominant_9box);
CREATE INDEX IF NOT EXISTS idx_filer_portfolios_modelable
    ON public.filer_portfolios_latest(is_modelable) WHERE is_modelable IS TRUE;


COMMIT;
