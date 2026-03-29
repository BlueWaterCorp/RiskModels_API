/*
  # ERM3 Schema Update and Market Heatmap Snapshot
  
  This migration ensures all ERM3 tables conform to the updated schema documentation
  at docs/data/ERM3_SUPABASE_SCHEMA.md (Last Updated: 2026-01-15)
  
  Changes:
  1. Ensures erm3_tickers, erm3_time_index, erm3_l3_decomposition match schema
  2. Creates market_heatmap_snapshot table (missing from current schema)
  3. Ensures all RLS policies match documentation
  4. Adds missing indexes
*/

-- ---------------------------------------------------------------------
-- 1. Ensure erm3_tickers table matches schema
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erm3_tickers (
  ticker text PRIMARY KEY,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Ensure RLS is enabled
ALTER TABLE erm3_tickers ENABLE ROW LEVEL SECURITY;

-- Read access (SELECT) for authenticated users
DROP POLICY IF EXISTS "allow_read_erm3_tickers" ON erm3_tickers;
CREATE POLICY "allow_read_erm3_tickers"
  ON erm3_tickers FOR SELECT TO authenticated USING (true);

-- Write access (INSERT/UPDATE) for authenticated users (service role)
DROP POLICY IF EXISTS "allow_write_erm3_tickers" ON erm3_tickers;
CREATE POLICY "allow_write_erm3_tickers"
  ON erm3_tickers FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_erm3_tickers" ON erm3_tickers;
CREATE POLICY "allow_update_erm3_tickers"
  ON erm3_tickers FOR UPDATE TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- 2. Ensure erm3_time_index table matches schema
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erm3_time_index (
  date date PRIMARY KEY,
  days_since_2007 int NOT NULL
);

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_erm3_time_index_days ON erm3_time_index(days_since_2007);

-- Ensure RLS is enabled
ALTER TABLE erm3_time_index ENABLE ROW LEVEL SECURITY;

-- Read access (SELECT) for authenticated users
DROP POLICY IF EXISTS "allow_read_erm3_time_index" ON erm3_time_index;
CREATE POLICY "allow_read_erm3_time_index"
  ON erm3_time_index FOR SELECT TO authenticated USING (true);

-- Write access (INSERT/UPDATE) for authenticated users (service role)
DROP POLICY IF EXISTS "allow_write_erm3_time_index" ON erm3_time_index;
CREATE POLICY "allow_write_erm3_time_index"
  ON erm3_time_index FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_erm3_time_index" ON erm3_time_index;
CREATE POLICY "allow_update_erm3_time_index"
  ON erm3_time_index FOR UPDATE TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- 3. Ensure erm3_l3_decomposition table matches schema
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erm3_l3_decomposition (
  market_factor_etf text NOT NULL,
  universe text NOT NULL,
  ticker text NOT NULL REFERENCES erm3_tickers(ticker) ON DELETE CASCADE,
  date date NOT NULL REFERENCES erm3_time_index(date) ON DELETE CASCADE,

  -- Hedge Ratios (HR)
  l1_market_hr double precision,
  l2_market_hr double precision,
  l2_sector_hr double precision,
  l3_market_hr double precision,
  l3_sector_hr double precision,
  l3_subsector_hr double precision,

  -- Explained Risk (ER)
  l1_market_er double precision,
  l1_residual_er double precision,

  l2_market_er double precision,
  l2_sector_er double precision,
  l2_residual_er double precision,

  l3_market_er double precision,
  l3_sector_er double precision,
  l3_subsector_er double precision,
  l3_residual_er double precision,

  PRIMARY KEY (market_factor_etf, universe, ticker, date)
);

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_erm3_l3_decomp_ticker_date 
  ON erm3_l3_decomposition(ticker, date);
CREATE INDEX IF NOT EXISTS idx_erm3_l3_decomp_run 
  ON erm3_l3_decomposition(market_factor_etf, universe);

-- Ensure RLS is enabled
ALTER TABLE erm3_l3_decomposition ENABLE ROW LEVEL SECURITY;

-- Read access (SELECT) for authenticated users
DROP POLICY IF EXISTS "allow_read_erm3_l3_decomposition" ON erm3_l3_decomposition;
CREATE POLICY "allow_read_erm3_l3_decomposition"
  ON erm3_l3_decomposition FOR SELECT TO authenticated USING (true);

-- Write access (INSERT/UPDATE) for authenticated users (service role)
DROP POLICY IF EXISTS "allow_write_erm3_l3_decomposition" ON erm3_l3_decomposition;
CREATE POLICY "allow_write_erm3_l3_decomposition"
  ON erm3_l3_decomposition FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_erm3_l3_decomposition" ON erm3_l3_decomposition;
CREATE POLICY "allow_update_erm3_l3_decomposition"
  ON erm3_l3_decomposition FOR UPDATE TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- 4. Create market_heatmap_snapshot table (NEW)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_heatmap_snapshot (
  ticker text PRIMARY KEY,
  name text,
  sector text,              -- GICS sector name
  industry text,            -- FactSet industry name
  market_cap float8,
  daily_return float8,      -- Daily return percentage
  last_updated timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_heatmap_sector ON market_heatmap_snapshot(sector);
CREATE INDEX IF NOT EXISTS idx_heatmap_industry ON market_heatmap_snapshot(industry);
CREATE INDEX IF NOT EXISTS idx_heatmap_last_updated ON market_heatmap_snapshot(last_updated DESC);

-- Enable RLS
ALTER TABLE market_heatmap_snapshot ENABLE ROW LEVEL SECURITY;

-- Read access (SELECT) for authenticated users
DROP POLICY IF EXISTS "allow_read_market_heatmap_snapshot" ON market_heatmap_snapshot;
CREATE POLICY "allow_read_market_heatmap_snapshot"
  ON market_heatmap_snapshot FOR SELECT TO authenticated USING (true);

-- Write access (INSERT/UPDATE) for authenticated users (service role)
DROP POLICY IF EXISTS "allow_write_market_heatmap_snapshot" ON market_heatmap_snapshot;
CREATE POLICY "allow_write_market_heatmap_snapshot"
  ON market_heatmap_snapshot FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_market_heatmap_snapshot" ON market_heatmap_snapshot;
CREATE POLICY "allow_update_market_heatmap_snapshot"
  ON market_heatmap_snapshot FOR UPDATE TO authenticated USING (true);

-- Add comments
COMMENT ON TABLE erm3_tickers IS 'Central ticker registry with optional metadata (sector, industry, etc.)';
COMMENT ON TABLE erm3_time_index IS 'Trading date registry with days_since_2007 for efficient date range queries';
COMMENT ON TABLE erm3_l3_decomposition IS 'Main fact table containing L1/L2/L3 hedge ratios (HR) and explained risk (ER) metrics';
COMMENT ON TABLE market_heatmap_snapshot IS 'Per-ticker snapshot for heatmap visualization with sector/industry grouping and latest daily returns';





