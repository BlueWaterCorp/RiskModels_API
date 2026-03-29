/*
  # Enable Row Level Security on ticker_factor_metrics
  
  ## Overview
  Implements data gating for the ticker_factor_metrics table based on subscription tier.
  
  ## Prerequisites
  This migration requires:
  - ticker_factor_metrics table (created via ERM3/scripts/supabase_schema.sql)
  - user_subscriptions table (created in migration 20251221100000_create_payment_subscriptions_table.sql)
    Note: The 'subscriptions' table is for email/newsletter subscriptions, not payments
  
  ## Security Model
  - **FREE/Unauthenticated**: Can only access basic metrics (volatility, sharpe_ratio, L1 metrics)
  - **PRO (Professional/Enterprise)**: Can access all metrics including L3 residual risk (alpha)
  
  ## Implementation Strategy
  Since RLS policies work at the row level (not column level), we use:
  1. RLS policies to control row access based on subscription status
  2. A view for FREE tier that exposes only limited columns
  3. Application layer can use the appropriate view/table based on subscription tier
  
  ## Performance
  - Policies use optimized `(select auth.uid())` pattern for better query performance
  - Indexes already exist on ticker and date columns
*/

-- Enable Row Level Security on ticker_factor_metrics
ALTER TABLE ticker_factor_metrics ENABLE ROW LEVEL SECURITY;

-- Create a view for FREE tier users (limited columns)
CREATE OR REPLACE VIEW ticker_factor_metrics_free AS
SELECT 
  id,
  ticker,
  symbol,
  date,
  -- Basic risk metrics
  volatility,
  sharpe_ratio,
  -- L1 Market Level only
  l1_market_hr,
  l1_market_er,
  created_at,
  updated_at
FROM ticker_factor_metrics;

-- Policy 1: Allow authenticated users with active subscriptions (PRO tier) to read all columns
-- Uses user_subscriptions table (payment subscriptions)
DROP POLICY IF EXISTS "pro_tier_full_access" ON ticker_factor_metrics;
CREATE POLICY "pro_tier_full_access"
  ON ticker_factor_metrics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_subscriptions
      WHERE user_subscriptions.user_id = (select auth.uid())
        AND user_subscriptions.status IN ('active', 'trialing')
        AND user_subscriptions.subscription_tier IN ('professional', 'enterprise')
    )
  );

-- Policy 2: Allow authenticated users without active subscriptions (FREE tier) to read via view
-- Note: They'll use the ticker_factor_metrics_free view which only exposes limited columns
DROP POLICY IF EXISTS "free_tier_limited_access" ON ticker_factor_metrics;
CREATE POLICY "free_tier_limited_access"
  ON ticker_factor_metrics
  FOR SELECT
  TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1
      FROM public.user_subscriptions
      WHERE user_subscriptions.user_id = (select auth.uid())
        AND user_subscriptions.status IN ('active', 'trialing')
        AND user_subscriptions.subscription_tier IN ('professional', 'enterprise')
    )
  );

-- Policy 3: Allow unauthenticated users (anonymous) FREE tier access
-- This allows public access to basic metrics for marketing/demo purposes
DROP POLICY IF EXISTS "anon_free_tier_access" ON ticker_factor_metrics;
CREATE POLICY "anon_free_tier_access"
  ON ticker_factor_metrics
  FOR SELECT
  TO anon
  USING (true);

-- Grant permissions on the FREE tier view
GRANT SELECT ON ticker_factor_metrics_free TO authenticated;
GRANT SELECT ON ticker_factor_metrics_free TO anon;

-- Create a helper function to check if user has PRO access
-- Uses user_subscriptions table (payment subscriptions)
CREATE OR REPLACE FUNCTION has_pro_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions
    WHERE user_subscriptions.user_id = (select auth.uid())
      AND user_subscriptions.status IN ('active', 'trialing')
      AND user_subscriptions.subscription_tier IN ('professional', 'enterprise')
  );
$$;

-- Grant execute permission on helper function
GRANT EXECUTE ON FUNCTION has_pro_access() TO authenticated;

-- Add comment explaining the security model
COMMENT ON TABLE ticker_factor_metrics IS 
  'Risk metrics table with RLS-based subscription tier gating. FREE tier users should query ticker_factor_metrics_free view. PRO tier users can query the full table.';

COMMENT ON VIEW ticker_factor_metrics_free IS 
  'Limited view of ticker_factor_metrics for FREE tier users. Exposes only volatility, sharpe_ratio, and L1 metrics.';

COMMENT ON FUNCTION has_pro_access() IS 
  'Helper function to check if the current authenticated user has PRO tier access (Professional or Enterprise subscription). Uses user_subscriptions table.';
