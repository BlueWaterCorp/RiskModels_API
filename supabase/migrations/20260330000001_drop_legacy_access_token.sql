-- Drop legacy access_token column from plaid_items
-- RUN THIS ONLY AFTER VERIFYING THAT ALL TOKENS HAVE BEEN MIGRATED TO encrypted_access_token
-- AND THE CODE HAS BEEN UPDATED TO USE THE NEW COLUMN.
ALTER TABLE public.plaid_items DROP COLUMN IF EXISTS access_token;
