-- Create user_positions table for storing current portfolio snapshots
-- This table stores the latest position state for each user's holdings
-- Enables instant dashboard loads and historical risk analysis

CREATE TABLE IF NOT EXISTS public.user_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  market_value NUMERIC,
  cost_basis NUMERIC,
  
  -- Source tracking for audit and reconciliation
  source TEXT NOT NULL CHECK (source IN ('plaid', 'manual_csv', 'merged')),
  source_account_id TEXT,  -- Plaid account_id or CSV filename
  institution_name TEXT,   -- Institution name for Plaid sources
  
  -- ERM3 universe filtering flags (pre-computed for performance)
  is_in_erm3_universe BOOLEAN DEFAULT false,
  is_hedgeable BOOLEAN DEFAULT false,
  
  -- Timestamps
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one row per user+ticker (enables UPSERT operations)
  CONSTRAINT user_positions_user_ticker_unique UNIQUE (user_id, ticker)
);

-- Performance indexes
CREATE INDEX idx_user_positions_user_id ON public.user_positions(user_id);
CREATE INDEX idx_user_positions_ticker ON public.user_positions(ticker);
CREATE INDEX idx_user_positions_source ON public.user_positions(source);
CREATE INDEX idx_user_positions_is_hedgeable ON public.user_positions(user_id, is_hedgeable) WHERE is_hedgeable = true;
CREATE INDEX idx_user_positions_last_synced ON public.user_positions(user_id, last_synced_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_positions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own positions
CREATE POLICY "Users can view own positions"
  ON public.user_positions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own positions
CREATE POLICY "Users can insert own positions"
  ON public.user_positions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own positions
CREATE POLICY "Users can update own positions"
  ON public.user_positions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own positions
CREATE POLICY "Users can delete own positions"
  ON public.user_positions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Admins can view all positions (for support)
CREATE POLICY "Admins can view all positions"
  ON public.user_positions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- RLS Policy: Service role can manage all positions (for background sync)
CREATE POLICY "Service role can manage positions"
  ON public.user_positions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER set_updated_at_user_positions
  BEFORE UPDATE ON public.user_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Comments for documentation
COMMENT ON TABLE public.user_positions IS 'Current portfolio positions snapshot for each user. Enables instant dashboard loads and eliminates Plaid PRODUCT_NOT_READY race conditions.';
COMMENT ON COLUMN public.user_positions.ticker IS 'Stock ticker symbol (uppercase). Should be in ERM3 universe for risk analysis.';
COMMENT ON COLUMN public.user_positions.quantity IS 'Number of shares held. Set to 0 for soft-delete (sold positions).';
COMMENT ON COLUMN public.user_positions.market_value IS 'Current market value (quantity × price). May be null for stale data.';
COMMENT ON COLUMN public.user_positions.cost_basis IS 'Total cost basis for tax reporting. May be null.';
COMMENT ON COLUMN public.user_positions.source IS 'Data source: plaid (from Plaid sync), manual_csv (from CSV upload), merged (combined sources).';
COMMENT ON COLUMN public.user_positions.source_account_id IS 'Plaid account_id or CSV filename for audit trail.';
COMMENT ON COLUMN public.user_positions.is_in_erm3_universe IS 'True if ticker exists in ERM3 risk model universe (~3,730 tickers).';
COMMENT ON COLUMN public.user_positions.is_hedgeable IS 'True if position can be hedged (in ERM3 universe AND quantity != 0). Includes both long and short positions.';
COMMENT ON COLUMN public.user_positions.last_synced_at IS 'Last time this position was updated from source (Plaid or CSV).';
