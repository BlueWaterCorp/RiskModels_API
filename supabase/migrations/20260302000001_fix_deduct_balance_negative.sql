-- Migration: Fix deduct_balance to handle negative balances
-- Date: 2026-03-02
-- Description: Updates deduct_balance RPC to reject negative balances

-- Update the deduct_balance function to block negative balances
CREATE OR REPLACE FUNCTION deduct_balance(
  p_user_id UUID,
  p_amount DECIMAL(12,4)
)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_balance DECIMAL(12,4);
BEGIN
  -- Get current balance with row lock
  SELECT balance_usd INTO v_current_balance
  FROM agent_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Check if balance is negative OR insufficient for the request
  -- This prevents users from going negative due to race conditions
  IF v_current_balance < 0 OR v_current_balance < p_amount THEN
    RETURN false;
  END IF;

  -- Deduct balance
  UPDATE agent_accounts
  SET balance_usd = balance_usd - p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION deduct_balance IS 'Atomically deducts balance. Returns false if balance is negative or insufficient. Uses FOR UPDATE lock to prevent race conditions.';
