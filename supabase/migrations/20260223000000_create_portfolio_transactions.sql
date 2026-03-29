/*
  # Portfolio Transactions - Encrypted Transaction History

  ## Overview
  Transforms user_transactions from plaintext-per-row to individually encrypted rows
  that share the same DEK as the portfolio's holdings. Deleting a portfolio's key
  atomically shreds both holdings AND transactions via CASCADE.

  ## Design Decisions
  - Unlike holdings (one blob per portfolio), transactions are stored as
    individual encrypted rows to support pagination and date-range queries.
  - Each row has 'encrypted_data' (BYTEA) for sensitive fields (ticker, quantity,
    price, amount, description) and 'metadata' (JSONB) for plaintext filter fields
    (transaction_date, category, status).
  - The 'key_id' FK with ON DELETE CASCADE links to portfolio_keys, ensuring one
    DELETE destroys both holdings and transactions atomically.

  ## Changes
  - Drops old plaintext columns from user_transactions
  - Adds portfolio_id, key_id (CASCADE), encrypted_data, metadata
  - Retains user_id for RLS and source columns for dedup
*/

-- 1. Drop existing indexes that reference columns being removed
DROP INDEX IF EXISTS idx_user_transactions_ticker;
DROP INDEX IF EXISTS idx_user_transactions_date;
DROP INDEX IF EXISTS idx_user_transactions_type;
DROP INDEX IF EXISTS idx_user_transactions_source_id;
DROP INDEX IF EXISTS idx_user_transactions_created_at;

-- Drop old unique constraint (we'll recreate with portfolio_id scope)
ALTER TABLE public.user_transactions
  DROP CONSTRAINT IF EXISTS user_transactions_unique_source;

-- 2. Clear existing data (cannot migrate plaintext to encrypted without DEKs)
TRUNCATE TABLE public.user_transactions CASCADE;

-- 3. Drop plaintext columns
ALTER TABLE public.user_transactions
  DROP COLUMN IF EXISTS ticker,
  DROP COLUMN IF EXISTS transaction_type,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS price,
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS transaction_date,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS metadata;

-- 4. Add encrypted columns + portfolio linkage (one column per statement for reliable application)
-- Prerequisite: run 20260222000000 (portfolios) and 20260222000001 (portfolio_keys) first.
ALTER TABLE public.user_transactions ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE public.user_transactions ADD COLUMN IF NOT EXISTS key_id UUID;
ALTER TABLE public.user_transactions ADD COLUMN IF NOT EXISTS encrypted_data BYTEA;
ALTER TABLE public.user_transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 5. Add foreign key constraints
-- Portfolio linkage
ALTER TABLE public.user_transactions
  ADD CONSTRAINT fk_user_transactions_portfolio
    FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id);

-- Key linkage (CASCADE: shredding the key destroys all transactions)
ALTER TABLE public.user_transactions
  ADD CONSTRAINT fk_user_transactions_key
    FOREIGN KEY (key_id) REFERENCES public.portfolio_keys(id) ON DELETE CASCADE;

-- 6. Set NOT NULL (table is empty after TRUNCATE)
ALTER TABLE public.user_transactions
  ALTER COLUMN portfolio_id SET NOT NULL,
  ALTER COLUMN key_id SET NOT NULL,
  ALTER COLUMN encrypted_data SET NOT NULL;

-- 7. Unique constraint for deduplication (portfolio-scoped).
-- NULLS DISTINCT (default): multiple rows with null source_transaction_id are allowed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'portfolio_id'
  ) THEN
    RAISE EXCEPTION 'Migration 20260223000000: user_transactions.portfolio_id missing. Run the full migration (steps 1–6) before step 7; ensure 20260222000000 and 20260222000001 have run first.';
  END IF;
END $$;
ALTER TABLE public.user_transactions
  DROP CONSTRAINT IF EXISTS user_transactions_dedup_unique;
ALTER TABLE public.user_transactions
  ADD CONSTRAINT user_transactions_dedup_unique
    UNIQUE (portfolio_id, source, source_transaction_id);

-- 8. Indexes for encrypted schema (IF NOT EXISTS for idempotent re-runs)
CREATE INDEX IF NOT EXISTS idx_user_transactions_user_id      ON public.user_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_portfolio_id ON public.user_transactions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_key_id       ON public.user_transactions(key_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_source_id    ON public.user_transactions(source_transaction_id)
  WHERE source_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_transactions_created_at   ON public.user_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_transactions_metadata     ON public.user_transactions USING GIN (metadata);

-- 9. Drop and recreate RLS policies
DROP POLICY IF EXISTS "Users can view own transactions"     ON public.user_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions"   ON public.user_transactions;
DROP POLICY IF EXISTS "Admins can view all transactions"    ON public.user_transactions;
DROP POLICY IF EXISTS "Service role can manage transactions" ON public.user_transactions;

CREATE POLICY "Users can view own transactions"
  ON public.user_transactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own transactions"
  ON public.user_transactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role can manage transactions"
  ON public.user_transactions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Documentation
COMMENT ON TABLE public.user_transactions IS
  'Individual encrypted transaction rows, each using the portfolio''s DEK. '
  'Shredding the portfolio key CASCADE-deletes all transactions atomically.';

COMMENT ON COLUMN public.user_transactions.encrypted_data IS
  'AES-256-GCM encrypted JSON of sensitive fields: '
  '{ticker, transaction_type, quantity, price, amount, description}. '
  'Encrypted with the same DEK as portfolio holdings.';

COMMENT ON COLUMN public.user_transactions.metadata IS
  'Plaintext JSONB for dashboard filtering without decryption. '
  'Contains: transaction_date (text), category (buy/sell/dividend/...), '
  'status (settled/pending), source, ticker_hmac.';
