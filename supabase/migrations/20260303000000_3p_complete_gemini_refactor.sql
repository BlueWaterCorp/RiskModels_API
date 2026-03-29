-- 1. ENUMS
CREATE TYPE asset_type AS ENUM ('stock', 'etf', 'mutual_fund');
CREATE TYPE periodicity AS ENUM ('daily', 'monthly', 'quarterly');

-- 2. SECURITY REGISTRY (The "Hard-Core" latest values)
-- Replaces: ticker_factor_metrics_*
CREATE TABLE symbols (
    symbol          TEXT PRIMARY KEY, -- FactSet ID (Stable Anchor)
    ticker          TEXT NOT NULL,    -- Current ticker (e.g., META)
    name            TEXT,
    asset_type      asset_type NOT NULL DEFAULT 'stock',

    -- Hard-Typed Core Risk (For high-speed sorting/filtering)
    latest_teo      DATE,
    latest_vol      REAL,
    latest_er_total REAL, -- Total Explained Risk (L1+L2+L3)
    latest_hr_mkt   REAL, -- Market Hedge Ratio

    -- Dynamic Extension (Experimental factors/rankings/secondary betas)
    latest_metrics  JSONB NOT NULL DEFAULT '{}',

    metadata        JSONB NOT NULL DEFAULT '{}', -- Company info, sector names, GICS
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SECURITY HISTORY (The "Long-Form" Time Series)
-- Maps 1:1 to Zarr coordinates (symbol, teo, metric_key)
CREATE TABLE security_history (
    symbol      TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    teo         DATE NOT NULL,
    periodicity periodicity NOT NULL,

    -- Coordinate from Zarr (e.g., 'return', 'beta_SPY', 'rank_21d_vol')
    metric_key  TEXT NOT NULL,
    value       REAL NOT NULL,

    PRIMARY KEY (symbol, teo, periodicity, metric_key)
);

-- 4. PUBLIC PORTFOLIOS (13Fs and Mutual Funds)
CREATE TABLE public_portfolios (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name   TEXT NOT NULL,
    ticker        TEXT UNIQUE, -- VTSAX, etc. (NULL for pure 13Fs)
    external_id   TEXT,        -- SEC CIK for 13Fs
    type          TEXT CHECK (type IN ('13F', 'Mutual Fund')),
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PORTFOLIO HOLDINGS (Long-form history)
CREATE TABLE portfolio_holdings (
    portfolio_id  UUID NOT NULL REFERENCES public_portfolios(id) ON DELETE CASCADE,
    teo           DATE NOT NULL, -- Snapshot date
    symbol        TEXT NOT NULL REFERENCES symbols(symbol),
    weight        REAL NOT NULL,
    shares        NUMERIC,
    market_value  NUMERIC,
    PRIMARY KEY (portfolio_id, teo, symbol)
);

-- 6. ZARR SYNC MANIFEST (The Sync Brain)
CREATE TABLE zarr_manifest (
    dataset_key  TEXT PRIMARY KEY, -- e.g., 'ds_erm3_betas'
    gcs_path     TEXT NOT NULL,
    variables    TEXT[],           -- List of metric_keys contained
    last_sync    TIMESTAMPTZ,
    is_active    BOOLEAN DEFAULT true
);

-- 7. INDEXES (Optimized for 2026 Fintech Patterns)

-- Fast ticker lookups and asset filtering
CREATE INDEX idx_symbols_ticker ON symbols(ticker);
CREATE INDEX idx_symbols_asset_type ON symbols(asset_type);
CREATE INDEX idx_symbols_metrics_gin ON symbols USING GIN (latest_metrics);

-- Time series lookups (e.g., "Give me the last 30 daily returns for AAPL")
-- Using B-Tree for the composite to support range scans on date
CREATE INDEX idx_history_lookup ON security_history (symbol, metric_key, teo DESC);
CREATE INDEX idx_history_date_scan ON security_history (teo DESC, metric_key);

-- Holdings lookups (e.g., "What does Berkshire hold as of 2025-12-31?")
CREATE INDEX idx_holdings_portfolio_date ON portfolio_holdings (portfolio_id, teo DESC);
CREATE INDEX idx_holdings_symbol_search ON portfolio_holdings (symbol, teo DESC);

-- 8. PERFORMANCE VIEWS
-- Maintain a materialized view for the most common "Top 10" dashboard items
CREATE MATERIALIZED VIEW mv_market_leaders AS
SELECT ticker, latest_er_total, latest_vol
FROM symbols
WHERE asset_type = 'stock'
ORDER BY latest_er_total DESC
LIMIT 100;

CREATE UNIQUE INDEX idx_mv_market_leaders_ticker ON mv_market_leaders (ticker);
