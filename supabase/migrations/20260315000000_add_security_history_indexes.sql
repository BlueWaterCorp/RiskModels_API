-- =====================================================
-- security_history Performance Indexes (Part 1 of 3)
-- =====================================================
--
-- MANUAL RUN REQUIRED: Supabase times out on 313M-row index builds.
-- Run the SQL below in Supabase Dashboard → SQL Editor with:
--   SET statement_timeout = '60min';
-- first, then execute each CREATE INDEX.
--
-- Part 1: Partial index for daily chart traffic
-- =====================================================

-- Migration no-op so history stays consistent. Run index creation manually:
/*
SET statement_timeout = '60min';

CREATE INDEX IF NOT EXISTS idx_security_history_daily_symbol_metric_teo
  ON public.security_history (symbol, metric_key, teo)
  WHERE periodicity = 'daily';

COMMENT ON INDEX idx_security_history_daily_symbol_metric_teo IS
  'Daily-only partial index for chart traffic';
*/

SELECT 1;
