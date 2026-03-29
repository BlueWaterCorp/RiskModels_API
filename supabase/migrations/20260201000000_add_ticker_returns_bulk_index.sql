-- Add composite index for efficient bulk queries on erm3_ticker_returns
-- This supports the preload-chart-data query pattern:
-- WHERE ticker IN (...) AND date >= '...' ORDER BY ticker, date

CREATE INDEX IF NOT EXISTS idx_erm3_ticker_returns_bulk_query
  ON erm3_ticker_returns(ticker, date DESC);

-- Add comment explaining the index usage
COMMENT ON INDEX idx_erm3_ticker_returns_bulk_query IS 
  'Optimizes bulk queries for multiple tickers with date range filter. Used by server-side preload for landing page chart data.';
