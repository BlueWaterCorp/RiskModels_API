-- Free Tier Usage Tracking Tables
-- Run: supabase db push

-- Track daily/monthly usage for free tier accounts
CREATE TABLE IF NOT EXISTS free_tier_usage (
  user_id TEXT PRIMARY KEY,
  queries_today INTEGER DEFAULT 0,
  queries_this_month INTEGER DEFAULT 0,
  last_query_at TIMESTAMPTZ,
  reset_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE free_tier_usage IS 'Tracks usage for free tier API accounts';
COMMENT ON COLUMN free_tier_usage.user_id IS 'User ID (free_xxx format)';
COMMENT ON COLUMN free_tier_usage.queries_today IS 'Number of queries executed today';
COMMENT ON COLUMN free_tier_usage.queries_this_month IS 'Number of queries executed this month';
COMMENT ON COLUMN free_tier_usage.reset_date IS 'When the daily limit resets (next midnight UTC)';

-- Index for fast lookups
CREATE INDEX idx_free_tier_usage_reset_date ON free_tier_usage(reset_date);

-- Track user tiers (free, paid, enterprise)
CREATE TABLE IF NOT EXISTS user_tiers (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'paid', 'enterprise')),
  rate_limit_per_minute INTEGER DEFAULT 60,
  queries_per_day INTEGER,
  queries_per_month INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE user_tiers IS 'Defines tier-based limits and capabilities';
COMMENT ON COLUMN user_tiers.tier IS 'User tier: free, paid, or enterprise';
COMMENT ON COLUMN user_tiers.rate_limit_per_minute IS 'Maximum queries per minute';
COMMENT ON COLUMN user_tiers.queries_per_day IS 'Daily query limit (NULL for unlimited)';

-- Add tier column to agent_accounts
ALTER TABLE agent_accounts
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'paid' CHECK (tier IN ('free', 'paid', 'enterprise'));

ALTER TABLE agent_accounts
ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER DEFAULT 60;

COMMENT ON COLUMN agent_accounts.tier IS 'Account tier for usage limits';
COMMENT ON COLUMN agent_accounts.rate_limit_per_minute IS 'Queries per minute limit';

-- Function to reset daily counters (run via cron)
CREATE OR REPLACE FUNCTION reset_free_tier_daily()
RETURNS INTEGER AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE free_tier_usage
  SET
    queries_today = 0,
    reset_date = (CURRENT_DATE + INTERVAL '1 day')::timestamptz
  WHERE reset_date <= NOW();

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql;

-- Grant access to service role (for API key authentication)
GRANT ALL ON free_tier_usage TO postgres;
GRANT ALL ON user_tiers TO postgres;

-- Note: RLS is disabled for these tables since we use API key auth, not Supabase auth
-- The application will enforce row-level security through API key validation
