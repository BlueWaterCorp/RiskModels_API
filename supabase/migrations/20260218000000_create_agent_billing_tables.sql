-- Migration: Agent Billing System
-- Date: 2026-02-18
-- Description: Creates tables for agent accounts, API keys, and per-request billing

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agent accounts table for programmatic API access
CREATE TABLE IF NOT EXISTS agent_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE agent_accounts IS 'Stores agent-specific account information for programmatic API access';
COMMENT ON COLUMN agent_accounts.agent_id IS 'Unique identifier for the agent (e.g., my-trading-agent-001)';
COMMENT ON COLUMN agent_accounts.balance_usd IS 'Current prepaid balance in USD for per-request billing';

-- API keys table for programmatic access
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT,
  scopes TEXT[] DEFAULT '{}',
  rate_limit_per_minute INTEGER DEFAULT 60,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

COMMENT ON TABLE agent_api_keys IS 'Stores hashed API keys for agent authentication';
COMMENT ON COLUMN agent_api_keys.key_hash IS 'Full hash of the API key (never store plain text)';
COMMENT ON COLUMN agent_api_keys.key_prefix IS 'First 8 characters for identification/display';
COMMENT ON COLUMN agent_api_keys.scopes IS 'Array of allowed capability IDs';

-- Billing events table for per-request billing and telemetry
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

COMMENT ON TABLE billing_events IS 'Logs every API request for billing and telemetry analysis';
COMMENT ON COLUMN billing_events.request_id IS 'Unique request ID for tracing (e.g., req_abc123)';
COMMENT ON COLUMN billing_events.capability_id IS 'Reference to the capability used';
COMMENT ON COLUMN billing_events.cost_usd IS 'Actual cost charged for this request';

-- Invoices table for agent billing
CREATE TABLE IF NOT EXISTS agent_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT,
  amount_usd DECIMAL(12,4) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'void')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  request_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

COMMENT ON TABLE agent_invoices IS 'Stores invoices for agent billing periods';

-- Top-up transactions table
CREATE TABLE IF NOT EXISTS balance_top_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT,
  amount_usd DECIMAL(12,4) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE balance_top_ups IS 'Records balance top-up transactions';

-- Telemetry metrics aggregate table (for fast health queries)
CREATE TABLE IF NOT EXISTS telemetry_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  capability_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  requests_total INTEGER DEFAULT 0,
  requests_success INTEGER DEFAULT 0,
  requests_failed INTEGER DEFAULT 0,
  latency_avg_ms INTEGER,
  latency_p95_ms INTEGER,
  latency_p99_ms INTEGER,
  revenue_usd DECIMAL(12,4),
  UNIQUE(capability_id, period_start)
);

COMMENT ON TABLE telemetry_metrics IS 'Pre-aggregated telemetry metrics for fast health dashboard queries';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_accounts_user_id ON agent_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_accounts_agent_id ON agent_accounts(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_accounts_status ON agent_accounts(status);

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_id ON agent_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_key_hash ON agent_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_revoked ON agent_api_keys(revoked_at) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_events_user_id ON billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_request_id ON billing_events(request_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_capability_id ON billing_events(capability_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_created_at ON billing_events(created_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_created_at_desc ON billing_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_invoices_user_id ON agent_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_status ON agent_invoices(status);

CREATE INDEX IF NOT EXISTS idx_balance_top_ups_user_id ON balance_top_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_top_ups_status ON balance_top_ups(status);

CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_capability_id ON telemetry_metrics(capability_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_period ON telemetry_metrics(period_start, period_end);

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for agent_accounts
DROP TRIGGER IF EXISTS update_agent_accounts_updated_at ON agent_accounts;
CREATE TRIGGER update_agent_accounts_updated_at
  BEFORE UPDATE ON agent_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to deduct balance safely (prevents negative balances)
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

  -- Check if sufficient balance
  IF v_current_balance < p_amount THEN
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

-- Function to add balance
CREATE OR REPLACE FUNCTION add_balance(
  p_user_id UUID,
  p_amount DECIMAL(12,4)
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO agent_accounts (user_id, balance_usd)
  VALUES (p_user_id, p_amount)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance_usd = agent_accounts.balance_usd + p_amount,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get usage summary (for dashboards)
CREATE OR REPLACE FUNCTION get_agent_usage_summary(
  p_user_id UUID,
  p_period TEXT DEFAULT 'day'
)
RETURNS TABLE (
  capability_id TEXT,
  requests_total BIGINT,
  requests_success BIGINT,
  requests_failed BIGINT,
  total_cost_usd DECIMAL,
  avg_latency_ms BIGINT
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
BEGIN
  v_start_date := CASE p_period
    WHEN 'day' THEN NOW() - INTERVAL '1 day'
    WHEN 'week' THEN NOW() - INTERVAL '7 days'
    WHEN 'month' THEN NOW() - INTERVAL '30 days'
    ELSE NOW() - INTERVAL '1 day'
  END;

  RETURN QUERY
  SELECT
    be.capability_id,
    COUNT(*)::BIGINT as requests_total,
    COUNT(*) FILTER (WHERE be.success = true)::BIGINT as requests_success,
    COUNT(*) FILTER (WHERE be.success = false)::BIGINT as requests_failed,
    COALESCE(SUM(be.cost_usd), 0)::DECIMAL as total_cost_usd,
    COALESCE(AVG(be.latency_ms), 0)::BIGINT as avg_latency_ms
  FROM billing_events be
  WHERE be.user_id = p_user_id
    AND be.created_at >= v_start_date
  GROUP BY be.capability_id
  ORDER BY requests_total DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable Row Level Security
ALTER TABLE agent_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_top_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies (idempotent: drop first if exists)
DROP POLICY IF EXISTS agent_accounts_user_isolation ON agent_accounts;
CREATE POLICY agent_accounts_user_isolation ON agent_accounts
  FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS agent_api_keys_user_isolation ON agent_api_keys;
CREATE POLICY agent_api_keys_user_isolation ON agent_api_keys
  FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS billing_events_user_isolation ON billing_events;
CREATE POLICY billing_events_user_isolation ON billing_events
  FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS agent_invoices_user_isolation ON agent_invoices;
CREATE POLICY agent_invoices_user_isolation ON agent_invoices
  FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS balance_top_ups_user_isolation ON balance_top_ups;
CREATE POLICY balance_top_ups_user_isolation ON balance_top_ups
  FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS telemetry_metrics_read_all ON telemetry_metrics;
CREATE POLICY telemetry_metrics_read_all ON telemetry_metrics
  FOR SELECT
  TO authenticated
  USING (true);

-- Grant necessary permissions
GRANT ALL ON agent_accounts TO authenticated;
GRANT ALL ON agent_api_keys TO authenticated;
GRANT ALL ON billing_events TO authenticated;
GRANT ALL ON agent_invoices TO authenticated;
GRANT ALL ON balance_top_ups TO authenticated;
GRANT SELECT ON telemetry_metrics TO authenticated;

-- Grant sequence usage
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
