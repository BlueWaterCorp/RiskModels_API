-- Migration: Agent Billing System (Optimized)
-- Date: 2026-02-18
-- Description: Creates tables for agent accounts, API keys, and per-request billing
-- NOTE: Run this in Supabase Dashboard SQL Editor if migration times out

-- Step 1: Create tables (if not exists)
CREATE TABLE IF NOT EXISTS agent_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id TEXT UNIQUE NOT NULL,
  agent_name TEXT NOT NULL,
  agent_version TEXT,
  contact_email TEXT NOT NULL,
  stripe_customer_id TEXT,
  balance_usd DECIMAL(12,4) DEFAULT 0.00,
  auto_top_up BOOLEAN DEFAULT false,
  auto_top_up_threshold DECIMAL(12,4) DEFAULT 5.00,
  auto_top_up_amount DECIMAL(12,4) DEFAULT 50.00,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT,
  scopes TEXT[] DEFAULT '{}',
  rate_limit_per_minute INTEGER DEFAULT 60,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(key_hash)
);

CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT false,
  status_code INTEGER,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT,
  amount_usd DECIMAL(12,4) NOT NULL,
  status TEXT DEFAULT 'pending',
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  request_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS balance_top_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT,
  amount_usd DECIMAL(12,4) NOT NULL,
  status TEXT DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Step 2: Create indexes one at a time
CREATE INDEX IF NOT EXISTS idx_agent_accounts_user_id ON agent_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_accounts_agent_id ON agent_accounts(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_id ON agent_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_user_id ON billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_created_at ON billing_events(created_at);

-- Step 3: Enable RLS
ALTER TABLE agent_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_top_ups ENABLE ROW LEVEL SECURITY;

-- Step 4: Create simple RLS policies (idempotent: drop first if exists)
DROP POLICY IF EXISTS agent_accounts_user_isolation ON agent_accounts;
CREATE POLICY agent_accounts_user_isolation ON agent_accounts
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS agent_api_keys_user_isolation ON agent_api_keys;
CREATE POLICY agent_api_keys_user_isolation ON agent_api_keys
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS billing_events_user_isolation ON billing_events;
CREATE POLICY billing_events_user_isolation ON billing_events
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS agent_invoices_user_isolation ON agent_invoices;
CREATE POLICY agent_invoices_user_isolation ON agent_invoices
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS balance_top_ups_user_isolation ON balance_top_ups;
CREATE POLICY balance_top_ups_user_isolation ON balance_top_ups
  FOR ALL USING (user_id = auth.uid());

-- Step 5: Create simple functions (no complex logic)
CREATE OR REPLACE FUNCTION deduct_balance(p_user_id UUID, p_amount DECIMAL)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE agent_accounts
  SET balance_usd = balance_usd - p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND balance_usd >= p_amount;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_balance(p_user_id UUID, p_amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  INSERT INTO agent_accounts (user_id, balance_usd, agent_id, agent_name, contact_email)
  VALUES (p_user_id, p_amount, 'temp-' || p_user_id, 'Temp', 'temp@example.com')
  ON CONFLICT (user_id) DO UPDATE
  SET balance_usd = agent_accounts.balance_usd + p_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
