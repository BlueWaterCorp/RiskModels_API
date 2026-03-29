/*
  # Make ticker_factor_metrics a Summary Table (Latest Date Only)
  
  ## Overview
  Converts `ticker_factor_metrics` from a full historical table to a summary table
  that only stores the latest date per ticker. This eliminates data duplication
  with `erm3_l3_decomposition` while keeping fast lookups for latest values.
  
  ## Migration Strategy: CTAS + Table Swap
  Uses CREATE TABLE AS (CTAS) to build a new compact table off to the side,
  then swaps tables via rename for minimal lock time. This avoids expensive
  DELETE operations and long-running transactions.
  
  ## Execution Plan
  Run this migration in phases during low-traffic windows.
  Each phase can be run separately if needed.
  
  ## IMPORTANT: Run Phases Separately if Timeouts Occur
  If you get timeouts, run each phase separately:
  1. Run Phase 1 only
  2. Wait, then run Phase 2 only
  3. Wait, then run Phase 3
  4. etc.
*/

-- ============================================================================
-- PHASE 1: Add new columns (safe, non-blocking, can run anytime)
-- ============================================================================

-- Add columns from ds_daily.zarr FIRST (before any structural changes)
ALTER TABLE ticker_factor_metrics
  ADD COLUMN IF NOT EXISTS bw_sector_code integer,
  ADD COLUMN IF NOT EXISTS fs_sector_code integer,
  ADD COLUMN IF NOT EXISTS fs_industry_code integer,
  ADD COLUMN IF NOT EXISTS market_cap double precision,
  ADD COLUMN IF NOT EXISTS close_price double precision;

-- ============================================================================
-- PHASE 2: Build new compact table with latest rows only (non-destructive)
-- ============================================================================
-- This phase can take time but doesn't lock the original table for writes.
-- If this times out, the table might be too large. Consider running in batches.

-- Drop new table if it exists (allows re-running this phase)
DROP TABLE IF EXISTS ticker_factor_metrics_new;

-- Create new table with only latest row per ticker using CTAS + window function
-- Using explicit column list to handle potential missing columns gracefully
CREATE TABLE ticker_factor_metrics_new AS
WITH ranked AS (
  SELECT
    id,
    ticker,
    COALESCE(symbol, ticker) as symbol,  -- Handle NULL symbols
    date,
    volatility,
    sharpe_ratio,
    l1_market_hr,
    l2_market_hr,
    l2_sector_hr,
    l3_market_hr,
    l3_sector_hr,
    l3_subsector_hr,
    l1_market_er,
    l1_residual_er,
    l2_market_er,
    l2_sector_er,
    l2_residual_er,
    l3_market_er,
    l3_sector_er,
    l3_subsector_er,
    l3_residual_er,
    bw_sector_code,
    fs_sector_code,
    fs_industry_code,
    market_cap,
    close_price,
    COALESCE(created_at, now()) as created_at,  -- Handle NULL created_at
    COALESCE(updated_at, now()) as updated_at,  -- Handle NULL updated_at
    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC NULLS LAST) AS rn
  FROM ticker_factor_metrics
  WHERE ticker IS NOT NULL  -- Filter out any NULL tickers
    AND date IS NOT NULL     -- Filter out any NULL dates
)
SELECT
  id,
  ticker,
  symbol,
  date,
  volatility,
  sharpe_ratio,
  l1_market_hr,
  l2_market_hr,
  l2_sector_hr,
  l3_market_hr,
  l3_sector_hr,
  l3_subsector_hr,
  l1_market_er,
  l1_residual_er,
  l2_market_er,
  l2_sector_er,
  l2_residual_er,
  l3_market_er,
  l3_sector_er,
  l3_subsector_er,
  l3_residual_er,
  bw_sector_code,
  fs_sector_code,
  fs_industry_code,
  market_cap,
  close_price,
  created_at,
  updated_at
FROM ranked
WHERE rn = 1;

-- ============================================================================
-- PHASE 3: Add constraints and indexes to new table (before swap)
-- ============================================================================

-- Set NOT NULL on ticker (if not already)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'ticker_factor_metrics_new' 
             AND column_name = 'ticker' 
             AND is_nullable = 'YES') THEN
    ALTER TABLE ticker_factor_metrics_new ALTER COLUMN ticker SET NOT NULL;
  END IF;
END $$;

-- Add unique constraint on ticker (drop first if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint 
             WHERE conname = 'ticker_factor_metrics_new_ticker_unique') THEN
    ALTER TABLE ticker_factor_metrics_new 
      DROP CONSTRAINT ticker_factor_metrics_new_ticker_unique;
  END IF;
  ALTER TABLE ticker_factor_metrics_new
    ADD CONSTRAINT ticker_factor_metrics_new_ticker_unique UNIQUE (ticker);
END $$;

-- Add primary key on ticker (drop first if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint 
             WHERE conname = 'ticker_factor_metrics_new_pkey') THEN
    ALTER TABLE ticker_factor_metrics_new 
      DROP CONSTRAINT ticker_factor_metrics_new_pkey;
  END IF;
  ALTER TABLE ticker_factor_metrics_new
    ADD PRIMARY KEY (ticker);
END $$;

-- Create indexes (after data is in place, faster than during insert)
CREATE INDEX IF NOT EXISTS idx_tfm_new_date ON ticker_factor_metrics_new(date DESC);
CREATE INDEX IF NOT EXISTS idx_tfm_new_ticker ON ticker_factor_metrics_new(ticker);
CREATE INDEX IF NOT EXISTS idx_tfm_new_sector ON ticker_factor_metrics_new(bw_sector_code) WHERE bw_sector_code IS NOT NULL;

-- Add check constraint
ALTER TABLE ticker_factor_metrics_new
  DROP CONSTRAINT IF EXISTS ticker_factor_metrics_new_date_check;
  
ALTER TABLE ticker_factor_metrics_new
  ADD CONSTRAINT ticker_factor_metrics_new_date_check 
  CHECK (date IS NOT NULL);

-- ============================================================================
-- PHASE 4: Add RLS policies to new table
-- ============================================================================

-- Enable RLS on new table
ALTER TABLE ticker_factor_metrics_new ENABLE ROW LEVEL SECURITY;

-- PRO tier: Full access (only if user_subscriptions table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name = 'user_subscriptions') THEN
    DROP POLICY IF EXISTS "pro_tier_full_access" ON ticker_factor_metrics_new;
    CREATE POLICY "pro_tier_full_access" ON ticker_factor_metrics_new
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_subscriptions
          WHERE user_subscriptions.user_id = (select auth.uid())
            AND user_subscriptions.status IN ('active', 'trialing')
            AND user_subscriptions.subscription_tier IN ('professional', 'enterprise')
        )
      );
  ELSE
    -- Fallback: allow all authenticated users if user_subscriptions doesn't exist
    DROP POLICY IF EXISTS "pro_tier_full_access" ON ticker_factor_metrics_new;
    CREATE POLICY "pro_tier_full_access" ON ticker_factor_metrics_new
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- FREE tier: Limited access (only if user_subscriptions table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name = 'user_subscriptions') THEN
    DROP POLICY IF EXISTS "free_tier_limited_access" ON ticker_factor_metrics_new;
    CREATE POLICY "free_tier_limited_access" ON ticker_factor_metrics_new
      FOR SELECT TO authenticated
      USING (
        NOT EXISTS (
          SELECT 1 FROM public.user_subscriptions
          WHERE user_subscriptions.user_id = (select auth.uid())
            AND user_subscriptions.status IN ('active', 'trialing')
            AND user_subscriptions.subscription_tier IN ('professional', 'enterprise')
        )
      );
  ELSE
    -- Fallback: allow all authenticated users if user_subscriptions doesn't exist
    DROP POLICY IF EXISTS "free_tier_limited_access" ON ticker_factor_metrics_new;
    CREATE POLICY "free_tier_limited_access" ON ticker_factor_metrics_new
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- Anonymous: Limited access
DROP POLICY IF EXISTS "anon_free_tier_access" ON ticker_factor_metrics_new;
CREATE POLICY "anon_free_tier_access" ON ticker_factor_metrics_new
  FOR SELECT TO anon USING (true);

-- ============================================================================
-- PHASE 5: Swap tables atomically (very fast, brief lock)
-- ============================================================================
-- Run this during a low-traffic window for minimal disruption.
-- The swap is nearly instantaneous (just metadata changes).

-- Check if new table exists and has data before swapping
DO $$
DECLARE
  new_table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO new_table_count FROM ticker_factor_metrics_new;
  
  IF new_table_count = 0 THEN
    RAISE EXCEPTION 'ticker_factor_metrics_new is empty! Cannot swap. Run Phase 2 first.';
  END IF;
  
  RAISE NOTICE 'ticker_factor_metrics_new has % rows. Proceeding with swap.', new_table_count;
END $$;

-- Rename old table to backup
ALTER TABLE ticker_factor_metrics RENAME TO ticker_factor_metrics_old;

-- Rename new table to production name
ALTER TABLE ticker_factor_metrics_new RENAME TO ticker_factor_metrics;

-- ============================================================================
-- PHASE 6: Recreate views, triggers, and functions
-- ============================================================================

-- Update the free view
CREATE OR REPLACE VIEW ticker_factor_metrics_free AS
SELECT 
  id,
  ticker,
  symbol,
  date,
  volatility,
  sharpe_ratio,
  l1_market_hr,
  l1_market_er,
  created_at,
  updated_at
FROM ticker_factor_metrics;

-- Grant permissions on view
GRANT SELECT ON ticker_factor_metrics_free TO authenticated;
GRANT SELECT ON ticker_factor_metrics_free TO anon;

-- Create AFTER trigger (safer than BEFORE trigger with DELETE)
-- This only runs if someone inserts an older date row (shouldn't happen with UPSERT)
DROP TRIGGER IF EXISTS trigger_maintain_ticker_factor_metrics_latest ON ticker_factor_metrics;
DROP FUNCTION IF EXISTS maintain_ticker_factor_metrics_latest();

CREATE OR REPLACE FUNCTION maintain_ticker_factor_metrics_latest()
RETURNS TRIGGER AS $$
BEGIN
  -- If someone manages to insert an older date row via custom SQL,
  -- keep only the latest row per ticker by removing strictly older rows
  DELETE FROM ticker_factor_metrics
  WHERE ticker = NEW.ticker
    AND date < NEW.date;
  RETURN NULL; -- No need to reinsert; row already present
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_maintain_ticker_factor_metrics_latest
  AFTER INSERT OR UPDATE ON ticker_factor_metrics
  FOR EACH ROW
  EXECUTE FUNCTION maintain_ticker_factor_metrics_latest();

-- ============================================================================
-- PHASE 7: Add table comment and validation
-- ============================================================================

-- Add comment to table
COMMENT ON TABLE ticker_factor_metrics IS 
  'Summary table storing only the latest date per ticker. Contains volatility, Sharpe ratio, latest HR/ER metrics, sector codes, market cap, and close price from ds_daily.zarr. For historical data, use erm3_l3_decomposition table. Use UPSERT pattern for writes: INSERT ... ON CONFLICT (ticker) DO UPDATE SET ... WHERE EXCLUDED.date > ticker_factor_metrics.date';

-- Validate the migration
DO $$
DECLARE
  row_count INTEGER;
  ticker_count INTEGER;
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM ticker_factor_metrics;
  SELECT COUNT(DISTINCT ticker) INTO ticker_count FROM ticker_factor_metrics;

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT ticker, COUNT(*) AS cnt
    FROM ticker_factor_metrics
    GROUP BY ticker
    HAVING COUNT(*) > 1
  ) d;

  RAISE NOTICE 'Migration verification:';
  RAISE NOTICE '  Total rows: %', row_count;
  RAISE NOTICE '  Distinct tickers: %', ticker_count;
  RAISE NOTICE '  Duplicate tickers: % (should be 0)', duplicate_count;

  IF row_count != ticker_count THEN
    RAISE WARNING 'Row count does not match ticker count!';
  END IF;

  IF duplicate_count > 0 THEN
    RAISE WARNING 'Found duplicate tickers! Migration may have issues.';
  END IF;
END $$;

-- ============================================================================
-- PHASE 8: Optional cleanup (run after verifying everything works)
-- ============================================================================
-- Uncomment the line below after you've verified the migration is successful
-- and you no longer need the backup table.

-- DROP TABLE IF EXISTS ticker_factor_metrics_old;
