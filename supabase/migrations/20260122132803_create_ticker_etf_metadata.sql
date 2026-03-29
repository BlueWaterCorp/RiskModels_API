/*
  # Stock and ETF Metadata Organization
  
  This migration creates three tables to consolidate ticker and ETF metadata:
  1. ticker_metadata - Stock ticker company names, sectors, and classifications
  2. etf_metadata - ETF hierarchy, names, and proxy information
  3. classification_mappings - FactSet to GICS sector/industry mappings
  
  These tables replace hardcoded metadata in frontend components.
*/

-- =====================================================================
-- 1. ticker_metadata: Primary table for stock ticker metadata
-- =====================================================================
CREATE TABLE IF NOT EXISTS ticker_metadata (
  ticker text PRIMARY KEY,
  company_name text NOT NULL,
  symbol text,  -- Internal symbol from ticker_df.csv
  market_cap numeric,
  dollar_volume numeric,
  last_teo date,
  
  -- Classification codes (from ticker_factor_metrics)
  bw_sector_code integer,
  fs_sector_code integer,
  fs_industry_code integer,
  
  -- Human-readable classifications (derived from codes)
  gics_sector_code integer,
  gics_sector_name text,
  factset_sector_name text,
  factset_industry_name text,
  
  -- ETF assignments (derived from industry codes)
  sector_etf text,  -- e.g., 'XLK', 'XLF'
  subsector_etf text,  -- e.g., 'SOXX', 'KBE'
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_company_name ON ticker_metadata(company_name);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_gics_sector ON ticker_metadata(gics_sector_code);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_fs_industry ON ticker_metadata(fs_industry_code);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_sector_etf ON ticker_metadata(sector_etf);

-- Enable RLS
ALTER TABLE ticker_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow all authenticated users to read
DROP POLICY IF EXISTS "allow_read_ticker_metadata" ON ticker_metadata;
CREATE POLICY "allow_read_ticker_metadata"
  ON ticker_metadata
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow public read access for unauthenticated users (landing page)
DROP POLICY IF EXISTS "allow_public_read_ticker_metadata" ON ticker_metadata;
CREATE POLICY "allow_public_read_ticker_metadata"
  ON ticker_metadata
  FOR SELECT
  TO anon
  USING (true);

-- Allow service role to write
DROP POLICY IF EXISTS "allow_write_ticker_metadata" ON ticker_metadata;
CREATE POLICY "allow_write_ticker_metadata"
  ON ticker_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE ticker_metadata IS 'Stock ticker metadata including company names, sectors, and ETF assignments';

-- =====================================================================
-- 2. etf_metadata: Comprehensive ETF metadata from etf_registry.py
-- =====================================================================
CREATE TABLE IF NOT EXISTS etf_metadata (
  ticker text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,  -- 'market', 'sector', 'subsector', 'style', 'macro'
  parent_sector text,  -- For subsectors: parent sector ETF (e.g., 'XLK' for 'SOXX')
  macro_category text,  -- For macro ETFs: 'fixed_income', 'commodities', etc.
  
  -- Proxy information (for ETFs with historical proxies)
  proxy_ticker text,
  proxy_cutover_date date,
  
  -- Hierarchy relationships
  is_market boolean DEFAULT false,
  is_sector boolean DEFAULT false,
  is_subsector boolean DEFAULT false,
  is_style boolean DEFAULT false,
  is_macro boolean DEFAULT false,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_etf_metadata_category ON etf_metadata(category);
CREATE INDEX IF NOT EXISTS idx_etf_metadata_parent_sector ON etf_metadata(parent_sector);
CREATE INDEX IF NOT EXISTS idx_etf_metadata_is_sector ON etf_metadata(is_sector) WHERE is_sector = true;
CREATE INDEX IF NOT EXISTS idx_etf_metadata_is_subsector ON etf_metadata(is_subsector) WHERE is_subsector = true;

-- Enable RLS
ALTER TABLE etf_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow all authenticated users to read
DROP POLICY IF EXISTS "allow_read_etf_metadata" ON etf_metadata;
CREATE POLICY "allow_read_etf_metadata"
  ON etf_metadata
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow public read access
DROP POLICY IF EXISTS "allow_public_read_etf_metadata" ON etf_metadata;
CREATE POLICY "allow_public_read_etf_metadata"
  ON etf_metadata
  FOR SELECT
  TO anon
  USING (true);

-- Allow service role to write
DROP POLICY IF EXISTS "allow_write_etf_metadata" ON etf_metadata;
CREATE POLICY "allow_write_etf_metadata"
  ON etf_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE etf_metadata IS 'ETF metadata including names, hierarchy, and proxy information from etf_registry.py';

-- =====================================================================
-- 3. classification_mappings: FactSet → GICS mappings
-- =====================================================================
CREATE TABLE IF NOT EXISTS classification_mappings (
  id serial PRIMARY KEY,
  factset_industry_code integer UNIQUE NOT NULL,
  factset_industry_name text,
  factset_sector_code integer,
  factset_sector_name text,
  gics_sector_code integer NOT NULL,
  gics_sector_name text NOT NULL,
  
  -- Subsector ETF assignment (from FS_INDUSTRY_TO_SUBSECTOR_ETFS)
  subsector_etfs text[],  -- Array of ETF tickers
  
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_classification_fs_industry ON classification_mappings(factset_industry_code);
CREATE INDEX IF NOT EXISTS idx_classification_gics_sector ON classification_mappings(gics_sector_code);
CREATE INDEX IF NOT EXISTS idx_classification_fs_sector ON classification_mappings(factset_sector_code);

-- Enable RLS
ALTER TABLE classification_mappings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow all authenticated users to read
DROP POLICY IF EXISTS "allow_read_classification_mappings" ON classification_mappings;
CREATE POLICY "allow_read_classification_mappings"
  ON classification_mappings
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow public read access
DROP POLICY IF EXISTS "allow_public_read_classification_mappings" ON classification_mappings;
CREATE POLICY "allow_public_read_classification_mappings"
  ON classification_mappings
  FOR SELECT
  TO anon
  USING (true);

-- Allow service role to write
DROP POLICY IF EXISTS "allow_write_classification_mappings" ON classification_mappings;
CREATE POLICY "allow_write_classification_mappings"
  ON classification_mappings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE classification_mappings IS 'FactSet industry/sector to GICS mappings with subsector ETF assignments';
