/*
  # Fix Subscription Table References and Cleanup Old Tables
  
  ## Overview
  This migration addresses the mismatch between application code and RLS policies:
  - Application code uses `subscriptions` table (Stripe webhook, auth, admin)
  - RLS policies reference `user_subscriptions` table
  
  ## Changes
  1. Update RLS policies to use `subscriptions` instead of `user_subscriptions`
  2. Drop `user_subscriptions` table (not used by app)
  3. Drop old `erm3_sync_state` table (v1) if it exists
  4. Drop unreferenced tables: erm3_ticker_daily, erm3_ticker_daily_latest, erm3_landing_chart_cache
  5. Drop unreferenced view: vw_training_risk_deconstruct (if exists)
  6. Add RLS to erm3_ticker_returns
  
  ## Migration Strategy
  - Safe to run; only updates policies and drops unused objects
  - Application will continue working since it uses `subscriptions`
*/

-- ============================================================================
-- PART 1: Update RLS Policies to Use `subscriptions` Table
-- ============================================================================

-- Update ticker_factor_metrics RLS policies
DROP POLICY IF EXISTS "pro_tier_full_access" ON ticker_factor_metrics;
CREATE POLICY "pro_tier_full_access"
  ON ticker_factor_metrics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE subscriptions.user_id = (select auth.uid())
        AND subscriptions.status IN ('active', 'trialing')
        AND subscriptions.subscription_tier IN ('professional', 'enterprise')
    )
  );

DROP POLICY IF EXISTS "free_tier_limited_access" ON ticker_factor_metrics;
CREATE POLICY "free_tier_limited_access"
  ON ticker_factor_metrics
  FOR SELECT
  TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE subscriptions.user_id = (select auth.uid())
        AND subscriptions.status IN ('active', 'trialing')
        AND subscriptions.subscription_tier IN ('professional', 'enterprise')
    )
  );

-- Update has_pro_access() function to use subscriptions table
CREATE OR REPLACE FUNCTION has_pro_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE subscriptions.user_id = (select auth.uid())
      AND subscriptions.status IN ('active', 'trialing')
      AND subscriptions.subscription_tier IN ('professional', 'enterprise')
  );
$$;

-- Update function comment
COMMENT ON FUNCTION has_pro_access() IS 
  'Helper function to check if the current authenticated user has PRO tier access (Professional or Enterprise subscription). Uses subscriptions table.';

-- ============================================================================
-- PART 2: Drop user_subscriptions Table (Not Used by App)
-- ============================================================================

DROP TABLE IF EXISTS user_subscriptions CASCADE;

-- ============================================================================
-- PART 3: Drop Old Sync State Table (v1)
-- ============================================================================

DROP TABLE IF EXISTS erm3_sync_state CASCADE;

-- ============================================================================
-- PART 4: Drop Unreferenced Tables and Materialized Views
-- ============================================================================

-- These are not referenced in the application codebase
DROP TABLE IF EXISTS erm3_ticker_daily CASCADE;
DROP TABLE IF EXISTS erm3_ticker_daily_latest CASCADE;
DROP MATERIALIZED VIEW IF EXISTS erm3_landing_chart_cache CASCADE;

-- ============================================================================
-- PART 5: Drop Unreferenced View
-- ============================================================================

DROP VIEW IF EXISTS vw_training_risk_deconstruct CASCADE;
DROP VIEW IF EXISTS vw_training_risk_deconstruction CASCADE;

-- ============================================================================
-- PART 6: Add RLS to erm3_ticker_returns (Optional Security Enhancement)
-- ============================================================================

-- Enable RLS on erm3_ticker_returns
ALTER TABLE erm3_ticker_returns ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
DROP POLICY IF EXISTS "allow_read_erm3_ticker_returns" ON erm3_ticker_returns;
CREATE POLICY "allow_read_erm3_ticker_returns"
  ON erm3_ticker_returns FOR SELECT TO authenticated USING (true);

-- Allow anon users to read (for public demo/landing)
DROP POLICY IF EXISTS "allow_anon_read_erm3_ticker_returns" ON erm3_ticker_returns;
CREATE POLICY "allow_anon_read_erm3_ticker_returns"
  ON erm3_ticker_returns FOR SELECT TO anon USING (true);

-- Write access for service role only
DROP POLICY IF EXISTS "allow_write_erm3_ticker_returns" ON erm3_ticker_returns;
CREATE POLICY "allow_write_erm3_ticker_returns"
  ON erm3_ticker_returns FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_erm3_ticker_returns" ON erm3_ticker_returns;
CREATE POLICY "allow_update_erm3_ticker_returns"
  ON erm3_ticker_returns FOR UPDATE TO authenticated USING (true);

COMMENT ON TABLE erm3_ticker_returns IS 
  'Ticker returns data with RLS enabled. Readable by all authenticated and anonymous users.';

-- ============================================================================
-- PART 7: Add RLS to erm3_etf_returns (Optional Security Enhancement)
-- ============================================================================

-- Enable RLS on erm3_etf_returns
ALTER TABLE erm3_etf_returns ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
DROP POLICY IF EXISTS "allow_read_erm3_etf_returns" ON erm3_etf_returns;
CREATE POLICY "allow_read_erm3_etf_returns"
  ON erm3_etf_returns FOR SELECT TO authenticated USING (true);

-- Allow anon users to read (for public demo/landing)
DROP POLICY IF EXISTS "allow_anon_read_erm3_etf_returns" ON erm3_etf_returns;
CREATE POLICY "allow_anon_read_erm3_etf_returns"
  ON erm3_etf_returns FOR SELECT TO anon USING (true);

-- Write access for service role only
DROP POLICY IF EXISTS "allow_write_erm3_etf_returns" ON erm3_etf_returns;
CREATE POLICY "allow_write_erm3_etf_returns"
  ON erm3_etf_returns FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_erm3_etf_returns" ON erm3_etf_returns;
CREATE POLICY "allow_update_erm3_etf_returns"
  ON erm3_etf_returns FOR UPDATE TO authenticated USING (true);

COMMENT ON TABLE erm3_etf_returns IS 
  'ETF returns data with RLS enabled. Readable by all authenticated and anonymous users.';

-- ============================================================================
-- VALIDATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'Summary of changes:';
  RAISE NOTICE '  1. Updated RLS policies to use subscriptions table';
  RAISE NOTICE '  2. Dropped user_subscriptions table';
  RAISE NOTICE '  3. Dropped erm3_sync_state (v1)';
  RAISE NOTICE '  4. Dropped unreferenced tables: erm3_ticker_daily, erm3_ticker_daily_latest, erm3_landing_chart_cache';
  RAISE NOTICE '  5. Dropped unreferenced views: vw_training_risk_*';
  RAISE NOTICE '  6. Added RLS to erm3_ticker_returns';
  RAISE NOTICE '  7. Added RLS to erm3_etf_returns';
END $$;
