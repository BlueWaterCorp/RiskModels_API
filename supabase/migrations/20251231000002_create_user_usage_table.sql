-- Create user_usage table for tracking API calls, PDF reports, etc.
CREATE TABLE IF NOT EXISTS user_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  api_calls INTEGER DEFAULT 0,
  pdf_reports_generated INTEGER DEFAULT 0,
  plaid_accounts_linked INTEGER DEFAULT 0,
  data_exports INTEGER DEFAULT 0,
  hedge_simulations INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_usage_user_id ON user_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_date ON user_usage(date DESC);
CREATE INDEX IF NOT EXISTS idx_user_usage_user_date ON user_usage(user_id, date DESC);

-- Enable RLS
ALTER TABLE user_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own usage
CREATE POLICY "Users can view own usage"
  ON user_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role can manage usage (for server-side tracking)
CREATE POLICY "Service role can manage usage"
  ON user_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Admins can view all usage
CREATE POLICY "Admins can view all usage"
  ON user_usage
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Function to increment usage counter
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_metric TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert or update usage for today
  INSERT INTO user_usage (user_id, date, api_calls, pdf_reports_generated, plaid_accounts_linked, data_exports, hedge_simulations)
  VALUES (
    p_user_id,
    CURRENT_DATE,
    CASE WHEN p_metric = 'api_calls' THEN p_amount ELSE 0 END,
    CASE WHEN p_metric = 'pdf_reports' THEN p_amount ELSE 0 END,
    CASE WHEN p_metric = 'plaid_accounts' THEN p_amount ELSE 0 END,
    CASE WHEN p_metric = 'data_exports' THEN p_amount ELSE 0 END,
    CASE WHEN p_metric = 'hedge_simulations' THEN p_amount ELSE 0 END
  )
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    api_calls = CASE WHEN p_metric = 'api_calls' THEN user_usage.api_calls + p_amount ELSE user_usage.api_calls END,
    pdf_reports_generated = CASE WHEN p_metric = 'pdf_reports' THEN user_usage.pdf_reports_generated + p_amount ELSE user_usage.pdf_reports_generated END,
    plaid_accounts_linked = CASE WHEN p_metric = 'plaid_accounts' THEN user_usage.plaid_accounts_linked + p_amount ELSE user_usage.plaid_accounts_linked END,
    data_exports = CASE WHEN p_metric = 'data_exports' THEN user_usage.data_exports + p_amount ELSE user_usage.data_exports END,
    hedge_simulations = CASE WHEN p_metric = 'hedge_simulations' THEN user_usage.hedge_simulations + p_amount ELSE user_usage.hedge_simulations END,
    updated_at = NOW();
END;
$$;

-- Function to get usage for current period
CREATE OR REPLACE FUNCTION get_user_usage_summary(
  p_user_id UUID,
  p_period TEXT DEFAULT 'day' -- 'day', 'month', 'year'
)
RETURNS TABLE (
  api_calls_total INTEGER,
  pdf_reports_total INTEGER,
  plaid_accounts_total INTEGER,
  data_exports_total INTEGER,
  hedge_simulations_total INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_start_date DATE;
BEGIN
  -- Determine start date based on period
  CASE p_period
    WHEN 'day' THEN
      v_start_date := CURRENT_DATE;
    WHEN 'month' THEN
      v_start_date := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    WHEN 'year' THEN
      v_start_date := DATE_TRUNC('year', CURRENT_DATE)::DATE;
    ELSE
      v_start_date := CURRENT_DATE;
  END CASE;

  RETURN QUERY
  SELECT
    COALESCE(SUM(api_calls), 0)::INTEGER,
    COALESCE(SUM(pdf_reports_generated), 0)::INTEGER,
    COALESCE(SUM(plaid_accounts_linked), 0)::INTEGER,
    COALESCE(SUM(data_exports), 0)::INTEGER,
    COALESCE(SUM(hedge_simulations), 0)::INTEGER
  FROM user_usage
  WHERE user_id = p_user_id
  AND date >= v_start_date;
END;
$$;

-- Comments
COMMENT ON TABLE user_usage IS 'Tracks daily usage metrics per user for quota enforcement';
COMMENT ON FUNCTION increment_usage IS 'Atomically increment a usage metric for a user';
COMMENT ON FUNCTION get_user_usage_summary IS 'Get aggregated usage for a time period (day/month/year)';

