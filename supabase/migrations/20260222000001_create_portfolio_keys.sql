/*
  # Portfolio Keys Table - KMS-Wrapped Data Encryption Keys

  ## Overview
  Stores GCP KMS-wrapped Data Encryption Keys (DEKs), one per portfolio.
  Each DEK is used to encrypt that portfolio's holdings data.
  
  Deleting a row from this table triggers CASCADE deletion of the portfolio's
  encrypted holdings (via the key_id foreign key in user_positions), making
  the data permanently irrecoverable even if backups exist.

  ## New Table
  
  ### `portfolio_keys`
  - `id` (uuid, primary key) - Unique key record identifier
  - `portfolio_id` (uuid, foreign key unique) - References portfolios(id), CASCADE on delete
  - `encrypted_dek` (bytea) - GCP KMS-wrapped DEK (AES-256 key encrypted with KEK)
  - `kms_key_version` (text) - GCP KMS CryptoKeyVersion that wrapped this DEK
  - `last_active_at` (timestamptz) - Last time this portfolio's data was accessed
  - `created_at` (timestamptz) - Key creation timestamp

  ## Security
  
  ### Portfolio Keys Table
  - Enable RLS
  - Users can SELECT their own portfolio keys (read-only for client-side checks)
  - Only service_role can INSERT/UPDATE/DELETE (key management is server-side)
  - Service role has full access

  ## Automated Crypto-Shredding
  - pg_cron job runs nightly at 3 AM UTC
  - Deletes keys where last_active_at < NOW() - 90 days
  - Per-portfolio granularity: only stale portfolios are shredded
*/

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create portfolio_keys table
CREATE TABLE IF NOT EXISTS public.portfolio_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID NOT NULL UNIQUE
                    REFERENCES public.portfolios(id) ON DELETE CASCADE,
  encrypted_dek   BYTEA NOT NULL,
  kms_key_version TEXT NOT NULL,
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_portfolio_keys_portfolio_id ON public.portfolio_keys(portfolio_id);
CREATE INDEX idx_portfolio_keys_last_active  ON public.portfolio_keys(last_active_at);
CREATE INDEX idx_portfolio_keys_kms_version  ON public.portfolio_keys(kms_key_version);

-- Enable Row Level Security
ALTER TABLE public.portfolio_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own portfolio keys
-- (Read-only - needed for client-side key_id reference checks)
CREATE POLICY "Users can view own portfolio keys"
  ON public.portfolio_keys FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolios
      WHERE portfolios.id = portfolio_keys.portfolio_id
        AND portfolios.user_id = auth.uid()
    )
  );

-- RLS Policy: Service role manages all keys
-- Key management (INSERT/UPDATE/DELETE) is server-side only
CREATE POLICY "Service role manages all keys"
  ON public.portfolio_keys FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 90-day inactivity shredder via pg_cron
-- Runs nightly at 3 AM UTC
-- Evaluates per-portfolio: only stale portfolios are shredded, siblings are preserved
SELECT cron.schedule(
  'shred-inactive-portfolio-keys',
  '0 3 * * *',
  $$DELETE FROM public.portfolio_keys
    WHERE last_active_at < NOW() - INTERVAL '90 days'$$
);

-- Documentation comments
COMMENT ON TABLE public.portfolio_keys IS
  'Stores GCP-KMS-wrapped Data Encryption Keys (DEKs), one per portfolio. '
  'Deleting a row here triggers CASCADE deletion of the portfolio''s encrypted holdings, '
  'making the data permanently irrecoverable (crypto-shredding).';

COMMENT ON COLUMN public.portfolio_keys.encrypted_dek IS
  'AES-256 DEK encrypted (wrapped) by the GCP KMS Master Key (KEK). '
  'The plaintext DEK is never stored - only held in memory during request processing.';

COMMENT ON COLUMN public.portfolio_keys.kms_key_version IS
  'Full GCP KMS CryptoKeyVersion resource name that wrapped this DEK. '
  'Format: projects/{project}/locations/{location}/keyRings/{keyRing}/cryptoKeys/{cryptoKey}/cryptoKeyVersions/{version}. '
  'Used to detect stale wrappings after KEK rotation.';

COMMENT ON COLUMN public.portfolio_keys.last_active_at IS
  'Timestamp of last data access for this portfolio. '
  'Updated on every read/write to the portfolio''s holdings. '
  'Keys inactive for 90+ days are automatically shredded by pg_cron.';
