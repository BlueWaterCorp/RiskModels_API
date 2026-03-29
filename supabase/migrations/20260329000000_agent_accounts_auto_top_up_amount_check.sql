-- Restrict auto_top_up_amount to allowed Stripe top-up tiers ($20 / $50 / $100).
-- agent_accounts columns auto_top_up, auto_top_up_threshold, auto_top_up_amount already exist from earlier migrations.

-- Normalize any legacy values before adding the constraint
UPDATE agent_accounts
SET auto_top_up_amount = CASE
  WHEN auto_top_up_amount <= 20 THEN 20
  WHEN auto_top_up_amount <= 50 THEN 50
  WHEN auto_top_up_amount <= 100 THEN 100
  ELSE 50
END
WHERE auto_top_up_amount IS NULL
   OR auto_top_up_amount NOT IN (20, 50, 100);

ALTER TABLE agent_accounts
  DROP CONSTRAINT IF EXISTS agent_accounts_auto_top_up_amount_allowed;

ALTER TABLE agent_accounts
  ADD CONSTRAINT agent_accounts_auto_top_up_amount_allowed
  CHECK (auto_top_up_amount IN (20, 50, 100));

COMMENT ON CONSTRAINT agent_accounts_auto_top_up_amount_allowed ON agent_accounts IS
  'Auto top-up charge amount must be one of $20, $50, or $100';
