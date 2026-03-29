-- Migration: Add balance_after_usd to billing_events
-- Date: 2026-03-06
-- Description: Adds balance tracking column for credit/debit operations

-- Add the missing column
ALTER TABLE billing_events
ADD COLUMN IF NOT EXISTS balance_after_usd DECIMAL(12,4);

-- Add type column if not exists (for credit/debit classification)
ALTER TABLE billing_events
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'debit' CHECK (type IN ('debit', 'credit', 'refund'));

-- Add description column if not exists
ALTER TABLE billing_events
ADD COLUMN IF NOT EXISTS description TEXT;

-- Update comments
COMMENT ON COLUMN billing_events.balance_after_usd IS 'Account balance after this transaction (for audit trail)';
COMMENT ON COLUMN billing_events.type IS 'Transaction type: debit (charge), credit (top-up), or refund';
COMMENT ON COLUMN billing_events.description IS 'Human-readable description of the transaction';
