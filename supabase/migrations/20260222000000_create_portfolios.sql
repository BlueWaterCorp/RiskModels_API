/*
  # Portfolios Table - Multi-Portfolio Support for Crypto-Shredding

  ## Overview
  Creates the portfolios table to support multiple portfolios per user.
  Each portfolio will have its own Data Encryption Key (DEK) for crypto-shredding,
  enabling per-portfolio data deletion without affecting sibling portfolios.

  ## New Table
  
  ### `portfolios`
  - `id` (uuid, primary key) - Unique portfolio identifier
  - `user_id` (uuid, foreign key) - References profiles(id), CASCADE on delete
  - `name` (text) - Portfolio name (e.g., "Default", "Retirement", "Trading")
  - `is_default` (boolean) - True for the auto-created default portfolio
  - `created_at` (timestamptz) - Portfolio creation timestamp
  - `updated_at` (timestamptz) - Last portfolio update timestamp

  ## Security
  
  ### Portfolios Table
  - Enable RLS
  - Users can CRUD their own portfolios
  - Service role has full access
  - Default portfolio auto-created on profile creation (via trigger)

  ## Triggers
  - Auto-create "Default" portfolio when profile is created
  - Auto-update updated_at timestamp on modification
*/

-- Create portfolios table
CREATE TABLE IF NOT EXISTS public.portfolios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Default',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each user can have multiple portfolios, but names must be unique per user
  CONSTRAINT portfolios_user_name_unique UNIQUE (user_id, name)
);

-- Performance index for user lookups
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON public.portfolios(user_id);

-- Enable Row Level Security
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own portfolios
DROP POLICY IF EXISTS "Users can view own portfolios" ON public.portfolios;
CREATE POLICY "Users can view own portfolios"
  ON public.portfolios FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policy: Users can insert their own portfolios
DROP POLICY IF EXISTS "Users can insert own portfolios" ON public.portfolios;
CREATE POLICY "Users can insert own portfolios"
  ON public.portfolios FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- RLS Policy: Users can update their own portfolios
DROP POLICY IF EXISTS "Users can update own portfolios" ON public.portfolios;
CREATE POLICY "Users can update own portfolios"
  ON public.portfolios FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policy: Users can delete their own portfolios
DROP POLICY IF EXISTS "Users can delete own portfolios" ON public.portfolios;
CREATE POLICY "Users can delete own portfolios"
  ON public.portfolios FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policy: Service role can manage all portfolios
DROP POLICY IF EXISTS "Service role can manage all portfolios" ON public.portfolios;
CREATE POLICY "Service role can manage all portfolios"
  ON public.portfolios FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Function to auto-create "Default" portfolio when a profile is created
-- This piggybacks on the existing handle_new_user() trigger chain:
-- auth.users INSERT -> profiles INSERT -> portfolios INSERT
CREATE OR REPLACE FUNCTION public.handle_new_portfolio()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.portfolios (user_id, name, is_default)
  VALUES (NEW.id, 'Default', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create "Default" portfolio on profile creation
DROP TRIGGER IF EXISTS on_profile_created_portfolio ON public.profiles;
CREATE TRIGGER on_profile_created_portfolio
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_portfolio();

-- Trigger to auto-update updated_at timestamp
-- Reuses the existing handle_updated_at() function
DROP TRIGGER IF EXISTS portfolios_updated_at ON public.portfolios;
CREATE TRIGGER portfolios_updated_at
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Documentation comments
COMMENT ON TABLE public.portfolios IS
  'Named portfolio containers per user. Each has its own DEK for crypto-shredding. '
  'Deleting the DEK makes the portfolio data irrecoverable, but the portfolio shell survives.';

COMMENT ON COLUMN public.portfolios.name IS
  'User-visible portfolio name. Must be unique per user.';

COMMENT ON COLUMN public.portfolios.is_default IS
  'True for the auto-created "Default" portfolio. Only one default per user.';
