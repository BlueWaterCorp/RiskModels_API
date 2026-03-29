/*
  # Fix RLS Performance and Security Issues

  ## Changes Made

  1. **RLS Policy Optimization**
     - Updated all RLS policies to use `(select auth.uid())` instead of `auth.uid()`
     - This prevents re-evaluation of auth function for each row, improving query performance at scale
     - Affected policies:
       - `profiles`: "Users can read own profile" and "Users can update own profile"
       - `subscriptions`: "Users can read own subscription"

  2. **Function Security Hardening**
     - Added explicit `search_path` to all functions to prevent search path manipulation
     - Functions updated:
       - `handle_new_user()`: Set search_path to 'public, auth'
       - `handle_updated_at()`: Set search_path to 'public'
     - This resolves "Function Search Path Mutable" security warnings

  ## Performance Impact
  - RLS policies will now cache auth.uid() result for the query instead of calling per row
  - Significantly improves performance for queries returning multiple rows

  ## Security Impact
  - Functions are now protected against search_path manipulation attacks
  - Ensures functions always reference the correct schema objects
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own subscription" ON subscriptions;

-- Recreate profiles policies with optimized auth.uid() calls
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- Recreate subscriptions policy with optimized auth.uid() call
CREATE POLICY "Users can read own subscription"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- Recreate handle_new_user function with explicit search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  );
  RETURN new;
END;
$$;

-- Recreate handle_updated_at function with explicit search_path
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;