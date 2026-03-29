-- Align Supabase schema with V3 Data Contract
-- Fixes: symbols missing columns (name, sector_etf, is_adr, isin)
--        security_history using 'value' instead of 'metric_value'
-- See: docs/supabase/V3_DATA_CONTRACT.md, PYTHON_V3_WRITE_SPEC.md

BEGIN;

-- 1. Add missing columns to symbols (V3 contract)
ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS sector_etf TEXT,
  ADD COLUMN IF NOT EXISTS is_adr BOOLEAN,
  ADD COLUMN IF NOT EXISTS isin TEXT;

COMMENT ON COLUMN public.symbols.name IS 'Security name (e.g., Apple Inc.). Pipeline populates from company_name.';
COMMENT ON COLUMN public.symbols.sector_etf IS 'Sector hedge mapping (e.g., XLK). Pipeline populates from factset.';
COMMENT ON COLUMN public.symbols.is_adr IS 'ADR indicator.';
COMMENT ON COLUMN public.symbols.isin IS 'International Securities Identification Number.';

-- 2. Rename security_history.value to metric_value (V3 contract) - idempotent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_history' AND column_name = 'value'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_history' AND column_name = 'metric_value'
  ) THEN
    ALTER TABLE public.security_history RENAME COLUMN value TO metric_value;
  END IF;
END $$;

-- 3. Change metric_value to FLOAT8 nullable (V3 allows nulls for missing data)
ALTER TABLE public.security_history
  ALTER COLUMN metric_value TYPE FLOAT8 USING metric_value::float8,
  ALTER COLUMN metric_value DROP NOT NULL;

COMMENT ON COLUMN public.security_history.metric_value IS 'Numeric metric value. V3 contract: use metric_value (not value).';

COMMIT;
