-- Add erm3_landing_chart_cache to erm3_sync_state_v3
-- Pipeline should upsert this row after each landing cache write (see PYTHON_V3_WRITE_SPEC.md)
-- This migration seeds current state from the table so admin dashboard shows it immediately.

BEGIN;

-- Seed sync state from actual erm3_landing_chart_cache contents
-- Uses SPY/GLOBAL since landing cache is a unified table (no per-universe partitioning)
INSERT INTO public.erm3_sync_state_v3 (table_name, market_factor_etf, universe, max_date, last_synced_at)
SELECT
  'erm3_landing_chart_cache',
  'SPY',
  'GLOBAL',
  (SELECT MAX(date) FROM public.erm3_landing_chart_cache),
  (SELECT MAX(updated_at) FROM public.erm3_landing_chart_cache)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erm3_sync_state_v3')
  AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erm3_landing_chart_cache')
ON CONFLICT (table_name, market_factor_etf, universe) DO UPDATE SET
  max_date = EXCLUDED.max_date,
  last_synced_at = EXCLUDED.last_synced_at;

COMMIT;
