/*
  # Create ticker_returns_cache table
  
  ## Overview
  Stores pre-computed ticker return data fetched from zarr to avoid repeated API calls.
  Used as a cache layer between the frontend and zarr data source.
  
  ## Schema
  - ticker: Ticker symbol (uppercase, unique)
  - meta: JSONB containing {market_etf, sector_etf, subsector_etf}
  - data: JSONB array of {date, stock, l1, l2, l3} objects
  - last_updated: Timestamp for cache invalidation
  - created_at: Record creation timestamp
*/

CREATE TABLE IF NOT EXISTS ticker_returns_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL UNIQUE,
  meta jsonb NOT NULL,
  data jsonb NOT NULL,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ticker_returns_cache_ticker ON ticker_returns_cache(ticker);
CREATE INDEX IF NOT EXISTS idx_ticker_returns_cache_updated ON ticker_returns_cache(last_updated);

-- Enable RLS (read-only for all authenticated users, no write restrictions for now)
ALTER TABLE ticker_returns_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all authenticated users to read cached data
CREATE POLICY "allow_read_ticker_cache"
  ON ticker_returns_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow service role to write (for API caching)
-- Note: In production, you may want to restrict writes to a service role
CREATE POLICY "allow_write_ticker_cache"
  ON ticker_returns_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "allow_update_ticker_cache"
  ON ticker_returns_cache
  FOR UPDATE
  TO authenticated
  USING (true);

-- Comment on table
COMMENT ON TABLE ticker_returns_cache IS 'Cache for ticker return data fetched from zarr datasets to reduce API calls';

