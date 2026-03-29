-- Create plaid_items table for storing Plaid connection metadata
-- This table securely stores access tokens and connection info without storing bank credentials

-- Ensure profiles table exists (should already exist from previous migration)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  company_name text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create plaid_items table
CREATE TABLE IF NOT EXISTS public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  access_token text NOT NULL, -- Encrypted, used to fetch fresh data (server-side only)
  item_id text NOT NULL UNIQUE, -- Unique identifier for the bank connection
  institution_name text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_plaid_items_user_id ON public.plaid_items(user_id);
CREATE INDEX IF NOT EXISTS idx_plaid_items_item_id ON public.plaid_items(item_id);

-- Enable Row Level Security
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read their own Plaid items
CREATE POLICY "Users can view own plaid items"
  ON public.plaid_items
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own Plaid items
CREATE POLICY "Users can insert own plaid items"
  ON public.plaid_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own Plaid items
CREATE POLICY "Users can update own plaid items"
  ON public.plaid_items
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own Plaid items
CREATE POLICY "Users can delete own plaid items"
  ON public.plaid_items
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically update updated_at
CREATE TRIGGER set_updated_at_plaid_items
  BEFORE UPDATE ON public.plaid_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Add comment to table
COMMENT ON TABLE public.plaid_items IS 'Stores Plaid connection metadata and encrypted access tokens for fetching user holdings data';
COMMENT ON COLUMN public.plaid_items.access_token IS 'Encrypted access token used server-side only to fetch fresh holdings data. Never exposed to client.';
COMMENT ON COLUMN public.plaid_items.item_id IS 'Unique Plaid item identifier for the bank connection';

