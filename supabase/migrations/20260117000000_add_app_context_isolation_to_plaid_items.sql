/*
  # Add App Context Isolation to plaid_items RLS Policies
  
  ## Overview
  Updates RLS policies on `plaid_items` to enforce application-context-based data isolation.
  Users can only access rows where `app_context` matches the `x-application-context` header
  sent by the client application.
  
  ## Prerequisites
  - `app_context` column must already exist on `plaid_items` table
  
  ## Changes Made
  1. Sets default value for `app_context` column to 'risk_models_net'
  2. Updates existing rows with NULL or old app_context values to 'risk_models_net'
  3. Updates RLS policies to check app_context matches header value
  
  ## Security Model
  - Policies check both user ownership (`auth.uid() = user_id`) AND app context match
  - Header value is extracted from `current_setting('request.headers', true)::json->>'x-application-context'`
  - This ensures users can only access data for the specific application they're using
  
  ## Performance
  - Uses optimized `(select auth.uid())` pattern for better query performance
  - App context check is performed after user ID check (indexed column)
*/

-- Step 1: Ensure app_context column has default value
ALTER TABLE public.plaid_items 
  ALTER COLUMN app_context SET DEFAULT 'risk_models_net';

-- Step 2: Update existing rows that are NULL or have old values
-- Update NULL values
UPDATE public.plaid_items 
SET app_context = 'risk_models_net'
WHERE app_context IS NULL;

-- Update old 'etf_hedges' or 'etfhedges' values (case-insensitive check)
UPDATE public.plaid_items 
SET app_context = 'risk_models_net'
WHERE LOWER(app_context) IN ('etf_hedges', 'etfhedges', 'etf-hedges');

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can insert own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can update own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can delete own plaid items" ON public.plaid_items;

-- Recreate SELECT policy with app context check
CREATE POLICY "Users can view own plaid items"
  ON public.plaid_items
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND app_context = current_setting('request.headers', true)::json->>'x-application-context'
  );

-- Recreate INSERT policy with app context check
CREATE POLICY "Users can insert own plaid items"
  ON public.plaid_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND app_context = current_setting('request.headers', true)::json->>'x-application-context'
  );

-- Recreate UPDATE policy with app context check
CREATE POLICY "Users can update own plaid items"
  ON public.plaid_items
  FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND app_context = current_setting('request.headers', true)::json->>'x-application-context'
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND app_context = current_setting('request.headers', true)::json->>'x-application-context'
  );

-- Recreate DELETE policy with app context check
CREATE POLICY "Users can delete own plaid items"
  ON public.plaid_items
  FOR DELETE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND app_context = current_setting('request.headers', true)::json->>'x-application-context'
  );

-- Add comment documenting the app context isolation
COMMENT ON COLUMN public.plaid_items.app_context IS 'Application context identifier. Used with x-application-context header in RLS policies to isolate data by application.';
