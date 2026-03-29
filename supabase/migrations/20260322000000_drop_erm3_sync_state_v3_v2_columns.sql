-- Drop legacy v2 columns from erm3_sync_state_v3
-- V3 contract only tracks max_date and last_synced_at (see PYTHON_V3_WRITE_SPEC.md)
-- These columns are never populated by the Python pipeline and cause confusion (NULL/0)

BEGIN;

-- Only alter if table exists (may have been created by Python pipeline)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erm3_sync_state_v3') THEN
    -- Drop v2 legacy columns if they exist
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'erm3_sync_state_v3' AND column_name = 'min_date') THEN
      ALTER TABLE public.erm3_sync_state_v3 DROP COLUMN min_date;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'erm3_sync_state_v3' AND column_name = 'total_records') THEN
      ALTER TABLE public.erm3_sync_state_v3 DROP COLUMN total_records;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'erm3_sync_state_v3' AND column_name = 'total_dates') THEN
      ALTER TABLE public.erm3_sync_state_v3 DROP COLUMN total_dates;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'erm3_sync_state_v3' AND column_name = 'last_updated_at') THEN
      ALTER TABLE public.erm3_sync_state_v3 DROP COLUMN last_updated_at;
    END IF;
  END IF;
END $$;

COMMIT;
