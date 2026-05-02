-- Funds_DAG → Supabase schema v1 (Phase 4 Slice 10)
--
-- Mirrors the stocks-side ERM3 → Supabase architecture
-- (security_history_latest + symbols + erm3_sync_state_v4) for mutual funds
-- and 9-box style cohorts. Three-axis temporal model is carried as columns
-- (report_date / filing_date / extracted_at) per docs/BITEMPORAL_v1.md.
--
-- v1 ships latest knowledge-mode snapshot only. v2 adds ?as_of= / ?mode=
-- query params on the API; this DDL is forward-compatible (the columns are
-- already here).
--
-- Pairs with: docs/ARCHITECTURE_FUNDS_API.md §4 (the canonical schema doc).
--
-- Mutual-fund only. 13F-side mirror tables (filers, filer_portfolios_latest,
-- filer_rankings_top, filer_holdings_top) ship in a follow-up migration with
-- Slice 13.

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE weighting_type AS ENUM ('ew', 'mv');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE cohort_type AS ENUM ('symbol', 'sector', 'fund');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE rank_period_window AS ENUM ('1m', '3m', '12m', '36m');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE funds_sync_status AS ENUM ('ok', 'partial', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 1. public.funds — registry, one row per mutual fund
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.funds (
    bw_fund_id                    TEXT        PRIMARY KEY,
    series_id                     TEXT,
    ticker                        TEXT,
    cik                           TEXT,
    fund_name                     TEXT,
    morningstar_category          TEXT,
    equity_style_9box             TEXT,
    style_link_method             TEXT,

    -- Q5 LOCKED: column reserved now; primary-class assignment logic deferred.
    -- API endpoints default to ?primary=true (filter where this column IS NULL).
    primary_bw_fund_id            TEXT,

    -- Three-axis temporal lineage (most-recent values seen for this fund)
    latest_report_date            DATE,         -- = user's "fund_date"
    latest_filing_date            DATE,         -- = user's "release_date"
    latest_extracted_at           TIMESTAMPTZ,  -- = user's "collection_date"

    -- Latest summary fields for fast registry-only reads
    latest_total_adj_mv           REAL,
    latest_n_holdings             INTEGER,
    latest_effective_n            REAL,

    -- Eviction grace tracking (mirrors ERM3 stocks 365-day policy)
    last_in_eligible_universe_at  DATE,

    metadata                      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funds_ticker
    ON public.funds(ticker);
CREATE INDEX IF NOT EXISTS idx_funds_cik
    ON public.funds(cik);
CREATE INDEX IF NOT EXISTS idx_funds_equity_style_9box
    ON public.funds(equity_style_9box);
CREATE INDEX IF NOT EXISTS idx_funds_primary_bw_fund_id
    ON public.funds(primary_bw_fund_id)
    WHERE primary_bw_fund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funds_latest_report_date
    ON public.funds(latest_report_date DESC);
CREATE INDEX IF NOT EXISTS idx_funds_last_in_eligible
    ON public.funds(last_in_eligible_universe_at);

COMMENT ON TABLE public.funds IS
    'Mutual fund registry (Funds_DAG canonical). One row per bw_fund_id. ETFs deferred to Benchmarking workstream per CEO backlog.';
COMMENT ON COLUMN public.funds.primary_bw_fund_id IS
    'Points to the primary share class for multi-share-class funds. NULL = this row IS the primary (or no primary chosen yet). API ?primary=true defaults to filtering on IS NULL.';
COMMENT ON COLUMN public.funds.latest_report_date IS
    'Most recent reported holdings as-of (= user-side "fund_date"). Source: max(report_date) across this fund''s zarr ds_ph.';
COMMENT ON COLUMN public.funds.latest_filing_date IS
    'SEC filing acceptance date for the latest snapshot (= user-side "release_date"). Drives knowledge-mode cutoff.';
COMMENT ON COLUMN public.funds.latest_extracted_at IS
    'When we last ingested data for this fund (= user-side "collection_date"). Reproducibility / audit.';


-- ---------------------------------------------------------------------------
-- 2. public.funds_latest — wide-row hot cache, one row per fund
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.funds_latest (
    bw_fund_id                          TEXT        PRIMARY KEY
                                        REFERENCES public.funds(bw_fund_id) ON DELETE CASCADE,

    -- Three-axis temporal triple — the row represents this exact (report_date,
    -- filing_date) pair. The sync writer dedupes amendments (latest filing wins
    -- per (bw_fund_id, report_date)) before upsert.
    report_date                         DATE        NOT NULL,
    filing_date                         DATE        NOT NULL,
    extracted_at                        TIMESTAMPTZ NOT NULL,

    -- Return components (Slice 8 ds_portfolio.zarr)
    portfolio_gross_return              REAL,
    portfolio_market_return             REAL,
    portfolio_sector_return             REAL,
    portfolio_subsector_return          REAL,
    portfolio_idiosyncratic_return      REAL,
    identity_residual                   REAL,

    -- Diagnostics (Slice 8)
    weight_sum                          REAL,
    n_holdings_active                   INTEGER,
    effective_n                         REAL,
    top10_weight_sum                    REAL,

    -- Denormalized for fast reads
    total_adj_mv                        REAL,
    equity_style_9box                   TEXT,
    n_funds_in_cell_at_report_date      INTEGER,

    -- Lineage (surfaced via API X-Risk-* headers and _metadata block)
    model_version                       TEXT,
    factor_set_id                       TEXT,
    last_synced_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata                            JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_funds_latest_equity_style_9box
    ON public.funds_latest(equity_style_9box);
CREATE INDEX IF NOT EXISTS idx_funds_latest_report_date
    ON public.funds_latest(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_funds_latest_filing_date
    ON public.funds_latest(filing_date DESC);

COMMENT ON TABLE public.funds_latest IS
    'Wide-row latest-snapshot cache, one row per fund. Mirrors security_history_latest for stocks. Knowledge-mode default; multi-row history lives in GCS Zarr. See ARCHITECTURE_FUNDS_API.md §4.2.';


-- ---------------------------------------------------------------------------
-- 3. public.style_portfolios_latest — one row per (cell, weighting)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.style_portfolios_latest (
    equity_style_9box               TEXT           NOT NULL,
    weighting                       weighting_type NOT NULL,

    -- Latest snapshot's temporal triple. filing_date_max = the max filing_date
    -- across funds in this cell at report_date (drives the cohort lag headline).
    report_date                     DATE           NOT NULL,
    filing_date_max                 DATE,
    extracted_at                    TIMESTAMPTZ,

    portfolio_gross_return          REAL,
    portfolio_market_return         REAL,
    portfolio_sector_return         REAL,
    portfolio_subsector_return      REAL,
    portfolio_idiosyncratic_return  REAL,
    identity_residual               REAL,

    weight_sum                      REAL,
    n_holdings_active               INTEGER,
    effective_n                     REAL,
    top10_weight_sum                REAL,

    n_funds_in_cell                 INTEGER,

    model_version                   TEXT,
    last_synced_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    metadata                        JSONB          NOT NULL DEFAULT '{}'::jsonb,

    PRIMARY KEY (equity_style_9box, weighting)
);

CREATE INDEX IF NOT EXISTS idx_style_portfolios_latest_report_date
    ON public.style_portfolios_latest(report_date DESC);

COMMENT ON TABLE public.style_portfolios_latest IS
    'Per-cell, per-weighting cohort portfolio metrics from Slice 6. One row per (cell, weighting). History in GCS Zarr.';


-- ---------------------------------------------------------------------------
-- 4. public.style_rankings_top — top-N rank rows at latest report_date
-- ---------------------------------------------------------------------------

-- Q1 LOCKED: N defaults to 50; tunable per-run via --top-n flag on the sync
-- script. Actual N stored in funds_sync_state_v1.metadata for audit.
-- Anything bigger than chosen N stays Zarr-only.

CREATE TABLE IF NOT EXISTS public.style_rankings_top (
    equity_style_9box   TEXT           NOT NULL,
    cohort_type         cohort_type    NOT NULL,
    entity_id           TEXT           NOT NULL,
    metric              TEXT           NOT NULL,
    period_window              rank_period_window    NOT NULL,

    -- For symbol/sector cohorts: 'ew' and 'mv' are both emitted as separate rows.
    -- For cohort_type='fund': fund-level returns are scalar (no EW/MV split);
    -- the sync writer stores 'ew' as a placeholder so weighting can be NOT NULL
    -- (Postgres rejects NULLs in PK columns). API endpoints for fund-cohort
    -- routes don't expose a weighting parameter.
    weighting           weighting_type NOT NULL DEFAULT 'ew',

    report_date         DATE           NOT NULL,
    filing_date_max     DATE,

    rank                INTEGER        NOT NULL,
    value               REAL,
    cohort_size         INTEGER,

    last_synced_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    PRIMARY KEY (equity_style_9box, cohort_type, entity_id, metric, period_window,
                 weighting, report_date)
);

-- Index optimized for "top N within (cell, cohort_type, metric, period_window, weighting)"
-- which is the canonical API read pattern.
CREATE INDEX IF NOT EXISTS idx_style_rankings_top_lookup
    ON public.style_rankings_top
       (equity_style_9box, cohort_type, metric, period_window, weighting, rank);

-- Index for "where does entity X rank?" queries
CREATE INDEX IF NOT EXISTS idx_style_rankings_top_entity
    ON public.style_rankings_top
       (cohort_type, entity_id, equity_style_9box);

COMMENT ON TABLE public.style_rankings_top IS
    'Top-N (default 50) rankings per (cell, cohort_type, metric, period_window, weighting) at latest report_date. Full panels in GCS Zarr. N tunable via --top-n flag; actual N recorded in funds_sync_state_v1.metadata.';
COMMENT ON COLUMN public.style_rankings_top.weighting IS
    'For symbol/sector cohorts: ''ew'' and ''mv'' both emitted as separate rows. For cohort_type=''fund'': scalar returns, sync writer stores ''ew'' placeholder (NOT NULL is required for PK). API fund-cohort routes don''t expose weighting.';


-- ---------------------------------------------------------------------------
-- 5. public.funds_sync_state_v1 — per-table sync audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.funds_sync_state_v1 (
    table_name          TEXT               NOT NULL,
    entity_universe     TEXT               NOT NULL DEFAULT 'mutual_funds',
                                                            -- 'mutual_funds' | 'filers_13f'

    -- Latest snapshot covered by this sync row
    max_report_date     DATE,
    max_filing_date     DATE,

    last_synced_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    row_count           INTEGER,
    write_method        TEXT,                                -- 'rest_upsert' | 'postgres_copy' | 'zarr_ssot'
    source_dataset      TEXT,                                -- e.g. 'fund_portfolios_zarr (Slice 8)'

    -- Top-N actually used in this run (audit; null for non-rankings tables)
    top_n_used          INTEGER,

    status              funds_sync_status  NOT NULL DEFAULT 'ok',
    error_message       TEXT,
    metadata            JSONB              NOT NULL DEFAULT '{}'::jsonb,

    PRIMARY KEY (table_name, entity_universe)
);

COMMENT ON TABLE public.funds_sync_state_v1 IS
    'Per-table sync state tracking. Mirrors erm3_sync_state_v4 for stocks. One row per (table_name, entity_universe). API freshness checks read this without scanning the data tables.';


-- ---------------------------------------------------------------------------
-- 6. updated_at trigger (reuse if already defined by stocks schema)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS funds_updated_at ON public.funds;
CREATE TRIGGER funds_updated_at
    BEFORE UPDATE ON public.funds
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();


COMMIT;
