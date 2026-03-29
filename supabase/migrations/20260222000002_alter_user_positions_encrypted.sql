/*
  # Alter user_positions for Encrypted Storage

  ## Overview
  Transforms user_positions from plaintext-per-ticker to encrypted-blob-per-portfolio.
  
  BREAKING CHANGE: This migration drops all plaintext columns (ticker, quantity, etc.)
  and replaces them with encrypted_holdings (BYTEA) + metadata (JSONB).
  
  ## Changes
  
  ### Dropped Columns (plaintext data)
  - ticker, quantity, market_value, cost_basis
  - source, source_account_id, institution_name
  - is_in_erm3_universe, is_hedgeable, last_synced_at
  
  ### Added Columns (encrypted storage)
  - portfolio_id (UUID FK -> portfolios)
  - key_id (UUID FK -> portfolio_keys, CASCADE on delete)
  - encrypted_holdings (BYTEA) - AES-256-GCM encrypted JSON blob of Position[]
  - metadata (JSONB) - Plaintext searchable aggregates (counts, HMACs)
  - version (INTEGER) - Optimistic concurrency control
  
  ## Schema After Migration
  
  user_positions:
    - id (UUID PK)
    - user_id (UUID FK -> profiles, for RLS)
    - portfolio_id (UUID FK -> portfolios, UNIQUE)
    - key_id (UUID FK -> portfolio_keys, CASCADE)
    - encrypted_holdings (BYTEA)
    - metadata (JSONB)
    - version (INTEGER)
    - created_at (TIMESTAMPTZ)
    - updated_at (TIMESTAMPTZ)
  
  Cardinality: One row per portfolio (down from many rows per user)
*/

-- 1. Drop existing objects that reference removed columns
DROP INDEX IF EXISTS idx_user_positions_ticker;
DROP INDEX IF EXISTS idx_user_positions_source;
DROP INDEX IF EXISTS idx_user_positions_is_hedgeable;
DROP INDEX IF EXISTS idx_user_positions_last_synced;
DROP INDEX IF EXISTS idx_user_positions_user_id;

-- Drop the old unique constraint (user_id, ticker)
ALTER TABLE public.user_positions
  DROP CONSTRAINT IF EXISTS user_positions_user_ticker_unique;

-- 2. Clear existing data (DESTRUCTIVE - cannot migrate plaintext to encrypted without DEKs)
-- WARNING: This deletes all existing position data. Users will need to re-sync from Plaid.
TRUNCATE TABLE public.user_positions CASCADE;

-- 3. Drop all plaintext columns
ALTER TABLE public.user_positions
  DROP COLUMN IF EXISTS ticker,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS market_value,
  DROP COLUMN IF EXISTS cost_basis,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS source_account_id,
  DROP COLUMN IF EXISTS institution_name,
  DROP COLUMN IF EXISTS is_in_erm3_universe,
  DROP COLUMN IF EXISTS is_hedgeable,
  DROP COLUMN IF EXISTS last_synced_at;

-- 4. Add encrypted columns + portfolio linkage
ALTER TABLE public.user_positions
  ADD COLUMN IF NOT EXISTS portfolio_id UUID,
  ADD COLUMN IF NOT EXISTS key_id UUID,
  ADD COLUMN IF NOT EXISTS encrypted_holdings BYTEA,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- 5. Add foreign key constraints
-- Portfolio linkage (no CASCADE - we want the portfolio shell to survive)
ALTER TABLE public.user_positions
  ADD CONSTRAINT fk_user_positions_portfolio
    FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id);

-- Key linkage (CASCADE on delete - shredding the key destroys the data)
ALTER TABLE public.user_positions
  ADD CONSTRAINT fk_user_positions_key
    FOREIGN KEY (key_id) REFERENCES public.portfolio_keys(id) ON DELETE CASCADE;

-- 6. Make encrypted columns NOT NULL after constraints are in place
-- (Table is empty after TRUNCATE, so this is safe)
ALTER TABLE public.user_positions
  ALTER COLUMN portfolio_id SET NOT NULL,
  ALTER COLUMN key_id SET NOT NULL,
  ALTER COLUMN encrypted_holdings SET NOT NULL;

-- 7. One encrypted row per portfolio (replaces the old user_id+ticker unique constraint)
ALTER TABLE public.user_positions
  ADD CONSTRAINT user_positions_portfolio_unique UNIQUE (portfolio_id);

-- 8. New indexes for encrypted schema
CREATE INDEX idx_user_positions_portfolio_id ON public.user_positions(portfolio_id);
CREATE INDEX idx_user_positions_key_id       ON public.user_positions(key_id);
CREATE INDEX idx_user_positions_user_id      ON public.user_positions(user_id);
CREATE INDEX idx_user_positions_metadata     ON public.user_positions USING GIN (metadata);

-- 9. Drop and recreate RLS policies for new schema
-- user_id is retained for fast RLS evaluation (denormalized from portfolios.user_id)
DROP POLICY IF EXISTS "Users can view own positions"       ON public.user_positions;
DROP POLICY IF EXISTS "Users can insert own positions"     ON public.user_positions;
DROP POLICY IF EXISTS "Users can update own positions"     ON public.user_positions;
DROP POLICY IF EXISTS "Users can delete own positions"     ON public.user_positions;
DROP POLICY IF EXISTS "Admins can view all positions"      ON public.user_positions;
DROP POLICY IF EXISTS "Service role can manage positions"  ON public.user_positions;

-- RLS Policy: Users can view their own positions
CREATE POLICY "Users can view own positions"
  ON public.user_positions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policy: Users can insert their own positions
CREATE POLICY "Users can insert own positions"
  ON public.user_positions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- RLS Policy: Users can update their own positions
CREATE POLICY "Users can update own positions"
  ON public.user_positions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policy: Service role can manage all positions
CREATE POLICY "Service role can manage positions"
  ON public.user_positions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Documentation comments
COMMENT ON TABLE public.user_positions IS
  'One encrypted holdings blob per portfolio. Plaintext metadata JSONB '
  'provides searchable aggregates (counts, sources) without decryption. '
  'user_id is denormalized from portfolios for RLS performance.';

COMMENT ON COLUMN public.user_positions.portfolio_id IS
  'Foreign key to portfolios table. One row per portfolio (replaces one-row-per-ticker).';

COMMENT ON COLUMN public.user_positions.key_id IS
  'Foreign key to portfolio_keys table with CASCADE on delete. '
  'When the DEK is shredded, this row is automatically deleted.';

COMMENT ON COLUMN public.user_positions.encrypted_holdings IS
  'AES-256-GCM encrypted JSON blob containing Position[] array. '
  'Format: base64(iv || ciphertext || authTag). Encrypted with the portfolio''s DEK.';

COMMENT ON COLUMN public.user_positions.metadata IS
  'Plaintext JSONB metadata for searchability without decryption. '
  'Contains: position_count, hedgeable_count, non_erm3_count, sources[], '
  'last_synced_at, ticker_hmacs[] (HMAC-SHA256 of each ticker for membership testing).';

COMMENT ON COLUMN public.user_positions.version IS
  'Optimistic concurrency control. Incremented on each write. '
  'UPDATE WHERE version = N prevents lost updates from concurrent writers.';
