-- Migration: Simple Performance Indexes
-- Date: 2026-02-18
-- Description: Adds basic indexes (run these one at a time if needed)

-- Core indexes for ticker lookups (should be fast)
CREATE INDEX IF NOT EXISTS idx_erm3_ticker_returns_ticker_date
  ON erm3_ticker_returns(ticker, date DESC);

-- Index for billing queries
CREATE INDEX IF NOT EXISTS idx_billing_events_user_capability
  ON billing_events(user_id, capability_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_created
  ON billing_events(created_at DESC);

-- API key lookup
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash
  ON agent_api_keys(key_hash)
  WHERE revoked_at IS NULL;
