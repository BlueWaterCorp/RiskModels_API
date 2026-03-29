-- Add institution_id column to plaid_items table
-- This allows us to fetch institution logos from Plaid's API

-- Add the institution_id column
ALTER TABLE public.plaid_items
ADD COLUMN IF NOT EXISTS institution_id text;

-- Create index for institution_id lookups
CREATE INDEX IF NOT EXISTS idx_plaid_items_institution_id
ON public.plaid_items(institution_id)
WHERE institution_id IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.plaid_items.institution_id IS 'Plaid institution identifier (e.g., ins_12345). Used to fetch institution metadata including logos from Plaid API.';
