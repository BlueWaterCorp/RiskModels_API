-- =====================================================
-- Fix landing chart cache refresh timeout
-- =====================================================
--
-- Problem: refresh_landing_chart_cache() times out when called via
-- Supabase RPC because the default statement_timeout (8s) is too short
-- for REFRESH MATERIALIZED VIEW on a growing erm3_ticker_returns table.
--
-- Fixes:
-- 1. Add UNIQUE INDEX to enable REFRESH MATERIALIZED VIEW CONCURRENTLY
--    (allows reads during refresh, avoids lock contention)
-- 2. Update function to SET statement_timeout = '60s' so the refresh
--    has enough time to complete even as the table grows
-- 3. Use CONCURRENTLY so the old data remains readable during refresh
-- =====================================================

-- Step 1: Add unique index required for CONCURRENTLY refresh
-- The combination (ticker, date) is unique in the view output
CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_cache_ticker_date_unique
  ON erm3_landing_chart_cache (ticker, date);

-- Step 2: Replace the function with timeout + CONCURRENTLY
CREATE OR REPLACE FUNCTION refresh_landing_chart_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY erm3_landing_chart_cache;
END;
$$;

COMMENT ON FUNCTION refresh_landing_chart_cache() IS
'Refreshes the landing page chart cache CONCURRENTLY (non-blocking).
Sets statement_timeout = 60s to avoid Supabase API timeout.
Call after syncing new data to erm3_ticker_returns.';

-- Re-grant execute permission
GRANT EXECUTE ON FUNCTION refresh_landing_chart_cache() TO service_role;
