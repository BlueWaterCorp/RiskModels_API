-- Migration: Add Auto-Refill Fields
-- Date: 2026-03-02
-- Description: Adds fields needed for automatic balance refill functionality

-- Add stripe_payment_method_id for auto-refill
ALTER TABLE agent_accounts
ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,
ADD COLUMN IF NOT EXISTS last_auto_refill_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS auto_top_up_failure_reason TEXT;

-- Add comments for documentation
COMMENT ON COLUMN agent_accounts.stripe_payment_method_id IS 'Stripe PaymentMethod ID for auto-refill charges';
COMMENT ON COLUMN agent_accounts.last_auto_refill_at IS 'Timestamp of last successful auto-refill';
COMMENT ON COLUMN agent_accounts.auto_top_up_failure_reason IS 'Reason for last auto-refill failure (if any)';

-- Create index for auto-refill cron job
CREATE INDEX IF NOT EXISTS idx_agent_accounts_auto_refill 
ON agent_accounts(auto_top_up, balance_usd, stripe_customer_id, stripe_payment_method_id)
WHERE auto_top_up = true;
