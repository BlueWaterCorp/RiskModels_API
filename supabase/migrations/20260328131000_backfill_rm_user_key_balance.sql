-- Backfill: ensure holders of active rm_user_* keys have at least $20 in agent_accounts.
-- Run once; safe to re-run (idempotent).

-- 1) Create missing agent_accounts for users who only have user_generated keys
INSERT INTO agent_accounts (
  user_id,
  agent_id,
  agent_name,
  contact_email,
  balance_usd,
  status,
  auto_top_up,
  auto_top_up_threshold,
  auto_top_up_amount
)
SELECT DISTINCT ON (u.user_id)
  u.user_id,
  'migrated_rm_user_' || REPLACE(u.user_id::text, '-', ''),
  'API User',
  COALESCE(p.email, 'unknown@example.com'),
  20,
  'active',
  false,
  5.00,
  50.00
FROM user_generated_api_keys u
LEFT JOIN profiles p ON p.id = u.user_id
WHERE u.revoked_at IS NULL
  AND (u.expires_at IS NULL OR u.expires_at > NOW())
  AND u.key_prefix ILIKE 'rm_user%'
  AND NOT EXISTS (SELECT 1 FROM agent_accounts a WHERE a.user_id = u.user_id)
ORDER BY u.user_id, u.created_at DESC;

-- 2) Top up existing accounts below $20
UPDATE agent_accounts a
SET
  balance_usd = 20,
  updated_at = NOW()
FROM (
  SELECT DISTINCT user_id
  FROM user_generated_api_keys
  WHERE revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
    AND key_prefix ILIKE 'rm_user%'
) u
WHERE a.user_id = u.user_id
  AND COALESCE(a.balance_usd, 0) < 20;
