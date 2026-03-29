-- Migration: Add Monthly Spend Cap Fields
-- Date: 2026-03-02
-- Description: Adds hard limit / monthly spend cap protection

-- Add monthly spend cap fields to agent_accounts
ALTER TABLE agent_accounts
ADD COLUMN IF NOT EXISTS monthly_spend_cap DECIMAL(12,4) DEFAULT NULL,  -- NULL means no cap
ADD COLUMN IF NOT EXISTS monthly_spend_usd DECIMAL(12,4) DEFAULT 0.00,  -- Current month's spend
ADD COLUMN IF NOT EXISTS monthly_spend_reset_at TIMESTAMPTZ DEFAULT NOW(); -- Last reset timestamp

-- Add comments for documentation
COMMENT ON COLUMN agent_accounts.monthly_spend_cap IS 'Hard limit on monthly API spend (NULL = unlimited)';
COMMENT ON COLUMN agent_accounts.monthly_spend_usd IS 'Accumulated spend for current billing period';
COMMENT ON COLUMN agent_accounts.monthly_spend_reset_at IS 'Timestamp when monthly_spend_usd was last reset';

-- Create index for monthly spend tracking
CREATE INDEX IF NOT EXISTS idx_agent_accounts_monthly_reset 
ON agent_accounts(monthly_spend_reset_at) 
WHERE monthly_spend_cap IS NOT NULL;

-- Function to check and reset monthly spend if needed
CREATE OR REPLACE FUNCTION check_reset_monthly_spend(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_last_reset TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
  v_current_month INTEGER := EXTRACT(MONTH FROM v_now);
  v_current_year INTEGER := EXTRACT(YEAR FROM v_now);
  v_reset_month INTEGER;
  v_reset_year INTEGER;
BEGIN
  -- Get last reset time
  SELECT monthly_spend_reset_at INTO v_last_reset
  FROM agent_accounts
  WHERE user_id = p_user_id;
  
  IF v_last_reset IS NULL THEN
    -- First time, just set the timestamp
    UPDATE agent_accounts
    SET monthly_spend_reset_at = v_now
    WHERE user_id = p_user_id;
    RETURN;
  END IF;
  
  -- Check if we're in a new month
  v_reset_month := EXTRACT(MONTH FROM v_last_reset);
  v_reset_year := EXTRACT(YEAR FROM v_last_reset);
  
  IF v_reset_year < v_current_year OR (v_reset_year = v_current_year AND v_reset_month < v_current_month) THEN
    -- New month, reset the counter
    UPDATE agent_accounts
    SET monthly_spend_usd = 0.00,
        monthly_spend_reset_at = v_now
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_reset_monthly_spend IS 'Resets monthly spend counter if we are in a new month';

-- Function to add to monthly spend (called when deducting balance)
CREATE OR REPLACE FUNCTION add_to_monthly_spend(p_user_id UUID, p_amount DECIMAL(12,4))
RETURNS VOID AS $$
BEGIN
  -- First check if we need to reset
  PERFORM check_reset_monthly_spend(p_user_id);
  
  -- Add to monthly spend
  UPDATE agent_accounts
  SET monthly_spend_usd = monthly_spend_usd + p_amount
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION add_to_monthly_spend IS 'Adds amount to monthly spend total (with auto-reset check)';
