/*
  # Create ticker_request_logs table
  
  ## Overview
  Analytics table to track ticker request frequency for caching strategy optimization.
  Used to determine which tickers should be pre-cached in Supabase.
  
  ## Schema
  - ticker: Ticker symbol requested
  - source: 'cache' or 'zarr' indicating where data was fetched from
  - requested_at: Timestamp of request
*/

CREATE TABLE IF NOT EXISTS ticker_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  source text NOT NULL CHECK (source IN ('cache', 'zarr')),
  requested_at timestamptz DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_ticker_request_logs_ticker ON ticker_request_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_ticker_request_logs_requested_at ON ticker_request_logs(requested_at);
CREATE INDEX IF NOT EXISTS idx_ticker_request_logs_source ON ticker_request_logs(source);

-- Composite index for frequency analysis
CREATE INDEX IF NOT EXISTS idx_ticker_request_logs_ticker_date ON ticker_request_logs(ticker, requested_at DESC);

-- Enable RLS (allow inserts from authenticated users, reads restricted to service role)
ALTER TABLE ticker_request_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to insert logs
CREATE POLICY "allow_insert_request_logs"
  ON ticker_request_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Restrict reads to service role (for analytics scripts)
-- Note: In production, you may want to create a separate analytics role
CREATE POLICY "allow_read_request_logs"
  ON ticker_request_logs
  FOR SELECT
  TO service_role
  USING (true);

-- Comment on table
COMMENT ON TABLE ticker_request_logs IS 'Analytics table tracking ticker request frequency for caching strategy optimization';

