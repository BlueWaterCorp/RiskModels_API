-- Fix subscription_tier check constraint to match application tier values.
-- The previous constraint may have been created with a different value set.
-- Drop and recreate to ensure it allows all tiers the application uses.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_subscription_tier_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_subscription_tier_check
  CHECK (subscription_tier IN ('professional', 'enterprise', 'agent_paygo', 'free'));
