-- Add deduplication flag for low-balance alert emails.
-- NULL means no alert sent yet (or was reset after a top-up).
-- Non-null means an alert was already sent for the current low-balance crossing.
ALTER TABLE agent_accounts
  ADD COLUMN IF NOT EXISTS low_balance_notified_at TIMESTAMPTZ DEFAULT NULL;
