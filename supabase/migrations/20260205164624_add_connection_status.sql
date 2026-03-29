-- Add connection lifecycle tracking to plaid_items table

-- Create enum for connection status
CREATE TYPE connection_status AS ENUM (
  'pending_initial_update',  -- Waiting for first INITIAL_UPDATE webhook
  'active',                   -- Connection healthy, data syncing
  'login_required',           -- User needs to re-authenticate
  'error',                    -- Connection error (see error_code)
  'removed'                   -- Item removed (will be deleted)
);

-- Add new columns to plaid_items
ALTER TABLE plaid_items 
  ADD COLUMN connection_status connection_status DEFAULT 'pending_initial_update' NOT NULL,
  ADD COLUMN last_webhook_event text,
  ADD COLUMN last_successful_update timestamptz,
  ADD COLUMN error_code text;

-- Default existing rows to 'active' (assume they're working)
UPDATE plaid_items SET connection_status = 'active' WHERE connection_status = 'pending_initial_update';

-- Add index for efficient status queries
CREATE INDEX idx_plaid_items_user_status ON plaid_items(user_id, connection_status);

-- Add index for error monitoring
CREATE INDEX idx_plaid_items_error ON plaid_items(connection_status) WHERE connection_status IN ('error', 'login_required');

-- Add comments for documentation
COMMENT ON TYPE connection_status IS 'Lifecycle state of a Plaid connection';
COMMENT ON COLUMN plaid_items.connection_status IS 'Current health/state of this Plaid item';
COMMENT ON COLUMN plaid_items.last_webhook_event IS 'Most recent webhook event code received from Plaid';
COMMENT ON COLUMN plaid_items.last_successful_update IS 'Timestamp of last successful data sync from Plaid';
COMMENT ON COLUMN plaid_items.error_code IS 'Specific Plaid error code for UI messaging (e.g., ITEM_LOGIN_REQUIRED, INVALID_CREDENTIALS)';
