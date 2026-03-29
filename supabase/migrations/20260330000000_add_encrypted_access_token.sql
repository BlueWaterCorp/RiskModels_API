-- Add encrypted_access_token column to plaid_items
ALTER TABLE public.plaid_items ADD COLUMN IF NOT EXISTS encrypted_access_token text;
COMMENT ON COLUMN public.plaid_items.encrypted_access_token IS 'AES-256-GCM encrypted access token used server-side only to fetch fresh holdings data.';
