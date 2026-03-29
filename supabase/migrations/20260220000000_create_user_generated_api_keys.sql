-- Migration: User-Generated API Keys
-- Date: 2026-02-20
-- Description: Creates table for users to self-manage API keys (complements existing agent_api_keys)

-- User-generated API keys table
-- This allows regular users (not just agents) to create and manage their own API keys
CREATE TABLE IF NOT EXISTS user_generated_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  scopes TEXT[] DEFAULT '{"read"}',
  rate_limit_per_minute INTEGER DEFAULT 60,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(key_hash)
);

-- Comments for documentation
COMMENT ON TABLE user_generated_api_keys IS 'Stores user-generated API keys for programmatic access. Complements agent_api_keys for non-agent users.';
COMMENT ON COLUMN user_generated_api_keys.key_hash IS 'SHA-256 hash of the API key (never store plain text)';
COMMENT ON COLUMN user_generated_api_keys.key_prefix IS 'First 16 characters for identification/display (e.g., rm_user_live_abc1)';
COMMENT ON COLUMN user_generated_api_keys.scopes IS 'Array of allowed scopes: read, write, admin';
COMMENT ON COLUMN user_generated_api_keys.revoked_at IS 'Timestamp when key was revoked (soft delete)';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_generated_api_keys_user_id ON user_generated_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_generated_api_keys_key_hash ON user_generated_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_user_generated_api_keys_active ON user_generated_api_keys(user_id, revoked_at) WHERE revoked_at IS NULL;

-- Enable Row Level Security
ALTER TABLE user_generated_api_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only see their own keys
CREATE POLICY user_generated_api_keys_select_own ON user_generated_api_keys
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can only insert their own keys
CREATE POLICY user_generated_api_keys_insert_own ON user_generated_api_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own keys (only name/description, not key_hash)
CREATE POLICY user_generated_api_keys_update_own ON user_generated_api_keys
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only delete (revoke) their own keys
CREATE POLICY user_generated_api_keys_delete_own ON user_generated_api_keys
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Grant permissions
GRANT ALL ON user_generated_api_keys TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Function to get user's active API key count
CREATE OR REPLACE FUNCTION get_user_api_key_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM user_generated_api_keys
    WHERE user_id = p_user_id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke all user API keys (useful for security incidents)
CREATE OR REPLACE FUNCTION revoke_all_user_api_keys(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_generated_api_keys
  SET revoked_at = NOW()
  WHERE user_id = p_user_id
    AND revoked_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
