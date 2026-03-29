-- Create user_transactions table for immutable transaction history
-- This table stores all buy/sell/dividend transactions for compliance and historical risk analysis
-- Transactions are append-only (never updated or deleted)

CREATE TABLE IF NOT EXISTS public.user_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  
  -- Transaction details
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('buy', 'sell', 'dividend', 'split', 'transfer', 'other')),
  quantity NUMERIC NOT NULL,
  price NUMERIC,
  amount NUMERIC,
  transaction_date DATE NOT NULL,
  
  -- Source tracking for deduplication
  source TEXT NOT NULL CHECK (source IN ('plaid', 'manual_csv')),
  source_transaction_id TEXT,  -- Plaid transaction_id or CSV row hash (MD5)
  source_account_id TEXT,      -- Plaid account_id or CSV filename
  
  -- Optional metadata
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate transactions from re-syncs
  CONSTRAINT user_transactions_unique_source 
    UNIQUE NULLS NOT DISTINCT (user_id, source, source_transaction_id)
);

-- Performance indexes
CREATE INDEX idx_user_transactions_user_id ON public.user_transactions(user_id);
CREATE INDEX idx_user_transactions_ticker ON public.user_transactions(ticker);
CREATE INDEX idx_user_transactions_date ON public.user_transactions(user_id, transaction_date DESC);
CREATE INDEX idx_user_transactions_type ON public.user_transactions(transaction_type);
CREATE INDEX idx_user_transactions_source_id ON public.user_transactions(source_transaction_id) WHERE source_transaction_id IS NOT NULL;
CREATE INDEX idx_user_transactions_created_at ON public.user_transactions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own transactions
CREATE POLICY "Users can view own transactions"
  ON public.user_transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own transactions
CREATE POLICY "Users can insert own transactions"
  ON public.user_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Transactions are immutable (no UPDATE or DELETE by users)
-- Only service role can modify for error correction

-- RLS Policy: Admins can view all transactions (for support)
CREATE POLICY "Admins can view all transactions"
  ON public.user_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- RLS Policy: Service role can manage all transactions (for background sync and error correction)
CREATE POLICY "Service role can manage transactions"
  ON public.user_transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE public.user_transactions IS 'Immutable transaction history for compliance and historical risk analysis. Transactions are append-only.';
COMMENT ON COLUMN public.user_transactions.ticker IS 'Stock ticker symbol (uppercase) for the security involved.';
COMMENT ON COLUMN public.user_transactions.transaction_type IS 'Type of transaction: buy, sell, dividend, split, transfer, other.';
COMMENT ON COLUMN public.user_transactions.quantity IS 'Number of shares involved. Positive for buy/dividend, negative for sell.';
COMMENT ON COLUMN public.user_transactions.price IS 'Price per share at transaction time. May be null for dividends.';
COMMENT ON COLUMN public.user_transactions.amount IS 'Total transaction amount (quantity × price). Positive for inflow, negative for outflow.';
COMMENT ON COLUMN public.user_transactions.transaction_date IS 'Date the transaction occurred (not when it was recorded).';
COMMENT ON COLUMN public.user_transactions.source IS 'Data source: plaid (from Plaid sync) or manual_csv (from CSV upload).';
COMMENT ON COLUMN public.user_transactions.source_transaction_id IS 'Unique ID from source for deduplication: Plaid investment_transaction_id or MD5 hash for CSV.';
COMMENT ON COLUMN public.user_transactions.source_account_id IS 'Plaid account_id or CSV filename for audit trail.';
COMMENT ON COLUMN public.user_transactions.metadata IS 'Additional transaction details as JSON (fees, exchange, notes, etc.).';
