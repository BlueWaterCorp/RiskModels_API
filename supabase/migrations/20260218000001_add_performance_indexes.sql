-- Migration: Performance Indexes for Agent API
-- Date: 2026-02-18
-- Description: Adds indexes for sub-200ms query performance

-- Index for ticker returns lookups (most common query)
CREATE INDEX IF NOT EXISTS idx_erm3_ticker_returns_ticker_date_desc
  ON erm3_ticker_returns(ticker, date DESC);

-- Composite index for date range queries
CREATE INDEX IF NOT EXISTS idx_erm3_ticker_returns_ticker_date_range
  ON erm3_ticker_returns(ticker, date)
  INCLUDE (gross_return, l1, l2, l3);

-- Index for L3 decomposition lookups
CREATE INDEX IF NOT EXISTS idx_erm3_l3_decomposition_ticker_date
  ON erm3_l3_decomposition(ticker, date DESC);

-- Index for ETF returns
CREATE INDEX IF NOT EXISTS idx_erm3_etf_returns_etf_date
  ON erm3_etf_returns(etf, date);

-- Partial index for recent data only (hot data)
CREATE INDEX IF NOT EXISTS idx_erm3_ticker_returns_recent
  ON erm3_ticker_returns(ticker, date DESC)
  WHERE date >= '2024-01-01';

-- Index for billing events queries (used in telemetry)
CREATE INDEX IF NOT EXISTS idx_billing_events_user_capability
  ON billing_events(user_id, capability_id, created_at DESC);

-- Index for fast health checks
CREATE INDEX IF NOT EXISTS idx_billing_events_capability_created
  ON billing_events(capability_id, created_at DESC)
  WHERE created_at > NOW() - INTERVAL '24 hours';

-- Index for agent account lookups
CREATE INDEX IF NOT EXISTS idx_agent_accounts_user_status
  ON agent_accounts(user_id, status)
  WHERE status = 'active';

-- Index for API key validation (fast lookup by hash)
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash_active
  ON agent_api_keys(key_hash)
  WHERE revoked_at IS NULL;

-- Comment explaining the indexes
COMMENT ON INDEX idx_erm3_ticker_returns_ticker_date_desc IS 'Primary index for ticker returns API queries';
COMMENT ON INDEX idx_erm3_ticker_returns_ticker_date_range IS 'Covering index for faster ticker data retrieval';
COMMENT ON INDEX idx_billing_events_user_capability IS 'Index for usage summary and telemetry queries';

-- Analyze tables after creating indexes
ANALYZE erm3_ticker_returns;
ANALYZE erm3_l3_decomposition;
ANALYZE billing_events;
ANALYZE agent_accounts;
