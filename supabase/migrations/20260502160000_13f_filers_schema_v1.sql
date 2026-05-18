-- 13F filers schema (Funds_DAG Slice 13)
--
-- Adds the 13F mirror tables alongside the mutual-fund schema from
-- 20260502000000_funds_schema_v1.sql. Same patterns:
--   - Pure-Zarr SSOT (latest snapshot only; history in GCS)
--   - Three-axis temporal columns (report_date / filing_date / extracted_at)
--   - One-row-per-filer hot cache (filer_portfolios_latest)
--   - Top-N rank rows only (filer_rankings_top)
--
-- This migration is purely ADDITIVE — no changes to funds-side tables.
-- Funds-side AUM-column retrofit (aum_reported / aum_erm3 split) lives
-- on the feat/funds-stage-c-supabase branch; coordinated push later
-- once Stage B endpoint code is ready.
--
-- Slice 13 (filers_supabase_sync) populates only public.filers today
-- (2,472 filers from filer_master.db). The other 3 tables are
-- schema-ready but stay empty until raw 13F ingest is wired into the v3
-- asset graph.
--
-- Reuses funds-side enums (weighting_type, rank_period_window,
-- funds_sync_status). Adds new enum filer_partition_type for the 13F
-- cohort axis.

BEGIN;

-- ---------------------------------------------------------------------------
-- New enum: 13F partition axis
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE filer_partition_type AS ENUM ('filer_type', 'aum_tier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 1. public.filers — 13F filer registry
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.filers (
    bw_filer_id                   TEXT             PRIMARY KEY,
    cik                           TEXT,
    lei                           TEXT,
    name                          TEXT,
    filer_type                    TEXT,
    filer_subtype                 TEXT,
    country                       TEXT,
    status                        TEXT,
    style_label                   TEXT,
    factset_entity_id             TEXT,

    -- Three-axis temporal lineage (most-recent values seen for this filer)
    latest_report_date            DATE,
    latest_filing_date            DATE,
    latest_extracted_at           TIMESTAMPTZ,

    -- Latest summary fields. latest_aum_usd is the SEC-reported AUM
    -- from filer_master.latest_aum_usd. ERM3-universe-filtered AUM
    -- (latest_aum_erm3) is deferred — added by future migration when
    -- the funds-side retrofit lands and the CUSIP↔ERM3 namespace
    -- bridge slice ships.
    latest_aum_usd                DOUBLE PRECISION,
    aum_tier                      TEXT,
    latest_n_holdings             INTEGER,

    -- Eviction grace tracking (mirrors funds policy)
    last_in_eligible_universe_at  DATE,

    metadata                      JSONB            NOT NULL DEFAULT '{}'::jsonb,
    created_at                    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filers_cik
    ON public.filers(cik);
CREATE INDEX IF NOT EXISTS idx_filers_filer_type
    ON public.filers(filer_type);
CREATE INDEX IF NOT EXISTS idx_filers_aum_tier
    ON public.filers(aum_tier);
CREATE INDEX IF NOT EXISTS idx_filers_latest_report_date
    ON public.filers(latest_report_date DESC);
CREATE INDEX IF NOT EXISTS idx_filers_last_in_eligible
    ON public.filers(last_in_eligible_universe_at);

COMMENT ON TABLE public.filers IS
    '13F filer registry (Funds_DAG canonical). One row per bw_filer_id. Source: filer_master.db.';
COMMENT ON COLUMN public.filers.latest_aum_usd IS
    'Latest SEC-reported AUM as published by the filer. Source: filer_master.latest_aum_usd.';


-- ---------------------------------------------------------------------------
-- 2. public.filer_holdings_top — top-N current holdings per filer
-- ---------------------------------------------------------------------------
-- Schema-ready; populated by future slice once raw 13F ingest is wired
-- into v3 asset graph.

CREATE TABLE IF NOT EXISTS public.filer_holdings_top (
    bw_filer_id         TEXT             NOT NULL
                                         REFERENCES public.filers(bw_filer_id) ON DELETE CASCADE,
    symbol              TEXT             NOT NULL,
    report_date         DATE             NOT NULL,
    filing_date         DATE,
    extracted_at        TIMESTAMPTZ,

    rank                INTEGER          NOT NULL,
    weight              REAL,
    market_value_usd    DOUBLE PRECISION,
    n_holdings_total    INTEGER,

    last_synced_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    metadata            JSONB            NOT NULL DEFAULT '{}'::jsonb,

    PRIMARY KEY (bw_filer_id, symbol, report_date)
);

CREATE INDEX IF NOT EXISTS idx_filer_holdings_top_lookup
    ON public.filer_holdings_top(bw_filer_id, rank);
CREATE INDEX IF NOT EXISTS idx_filer_holdings_top_symbol
    ON public.filer_holdings_top(symbol, report_date DESC);

COMMENT ON TABLE public.filer_holdings_top IS
    'Top-N current holdings per 13F filer at latest report_date. Schema-ready; populated by future slice once raw 13F ingest is wired into the v3 asset graph and the CUSIP↔ERM3 bridge ships.';


-- ---------------------------------------------------------------------------
-- 3. public.filer_portfolios_latest — wide-row hot cache
-- ---------------------------------------------------------------------------
-- Schema-ready; populated by future slice. Note total_aum_usd here
-- mirrors funds_latest.total_adj_mv shape (single AUM column);
-- aum_reported/aum_erm3 split lands in a coordinated retrofit later.

CREATE TABLE IF NOT EXISTS public.filer_portfolios_latest (
    bw_filer_id                         TEXT             PRIMARY KEY
                                        REFERENCES public.filers(bw_filer_id) ON DELETE CASCADE,

    report_date                         DATE             NOT NULL,
    filing_date                         DATE             NOT NULL,
    extracted_at                        TIMESTAMPTZ      NOT NULL,

    -- Return components (per future per-filer ds_portfolio.zarr; NULL
    -- until CUSIP↔ERM3 bridge ships)
    portfolio_gross_return              REAL,
    portfolio_market_return             REAL,
    portfolio_sector_return             REAL,
    portfolio_subsector_return          REAL,
    portfolio_idiosyncratic_return      REAL,
    identity_residual                   REAL,

    -- Diagnostics
    weight_sum                          REAL,
    n_holdings_active                   INTEGER,
    effective_n                         REAL,
    top10_weight_sum                    REAL,

    total_aum_usd                       DOUBLE PRECISION,

    -- Denormalized for fast reads
    filer_type                          TEXT,
    aum_tier                            TEXT,

    -- Lineage
    model_version                       TEXT,
    factor_set_id                       TEXT,
    last_synced_at                      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    metadata                            JSONB            NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_filer_portfolios_filer_type
    ON public.filer_portfolios_latest(filer_type);
CREATE INDEX IF NOT EXISTS idx_filer_portfolios_aum_tier
    ON public.filer_portfolios_latest(aum_tier);
CREATE INDEX IF NOT EXISTS idx_filer_portfolios_report_date
    ON public.filer_portfolios_latest(report_date DESC);

COMMENT ON TABLE public.filer_portfolios_latest IS
    'Wide-row latest snapshot per 13F filer (knowledge-mode). Mirrors funds_latest. Schema-ready; populated by future slice.';


-- ---------------------------------------------------------------------------
-- 4. public.filer_rankings_top — top-N filers per cohort partition
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.filer_rankings_top (
    partition_type      filer_partition_type NOT NULL,
    partition_value     TEXT                 NOT NULL,
    bw_filer_id         TEXT                 NOT NULL,
    metric              TEXT                 NOT NULL,
    period_window       rank_period_window   NOT NULL,
    report_date         DATE                 NOT NULL,
    filing_date_max     DATE,

    rank                INTEGER              NOT NULL,
    value               REAL,
    cohort_size         INTEGER,

    last_synced_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    PRIMARY KEY (partition_type, partition_value, bw_filer_id, metric, period_window, report_date)
);

CREATE INDEX IF NOT EXISTS idx_filer_rankings_top_lookup
    ON public.filer_rankings_top
       (partition_type, partition_value, metric, period_window, rank);
CREATE INDEX IF NOT EXISTS idx_filer_rankings_top_filer
    ON public.filer_rankings_top(bw_filer_id);

COMMENT ON TABLE public.filer_rankings_top IS
    'Top-N filers per cohort partition at latest report_date. partition_type axis distinguishes filer_type vs aum_tier cohorts. Schema-ready; populated by future slice.';


-- ---------------------------------------------------------------------------
-- 5. Trigger: updated_at on filers (reuse function from funds schema)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS filers_updated_at ON public.filers;
CREATE TRIGGER filers_updated_at
    BEFORE UPDATE ON public.filers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();


COMMIT;
