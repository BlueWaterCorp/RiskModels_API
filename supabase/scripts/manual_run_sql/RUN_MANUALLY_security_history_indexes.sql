-- =====================================================
-- Run this in Supabase Dashboard → SQL Editor
-- =====================================================
--
-- These indexes time out when run via migrations on 313M-row security_history.
-- Execute this file manually. Each index may take 10–30+ minutes.
--
-- 1. Run SET statement_timeout first (0 = no limit; each index may take 1–2+ hours)
-- 2. To run one index at a time, comment out the other CREATE INDEX blocks
-- =====================================================

SET statement_timeout = '0';  -- Disable timeout; each index can take 1–2+ hours on 313M rows

-- Part 1: Partial index for daily chart traffic
CREATE INDEX IF NOT EXISTS idx_security_history_daily_symbol_metric_teo
  ON public.security_history (symbol, metric_key, teo)
  WHERE periodicity = 'daily';

COMMENT ON INDEX idx_security_history_daily_symbol_metric_teo IS
  'Daily-only partial index for chart traffic';

-- Part 2: Time-series reads (fetchHistory, fetchBatchHistory)
CREATE INDEX IF NOT EXISTS idx_security_history_symbol_period_metric_teo
  ON public.security_history (symbol, periodicity, metric_key, teo);

COMMENT ON INDEX idx_security_history_symbol_period_metric_teo IS
  'Time-series reads: fetchHistory, fetchBatchHistory';

-- Part 3: Latest-value reads (fetchLatestMetrics)
CREATE INDEX IF NOT EXISTS idx_security_history_symbol_period_metric_teo_desc
  ON public.security_history (symbol, periodicity, metric_key, teo DESC);

COMMENT ON INDEX idx_security_history_symbol_period_metric_teo_desc IS
  'Latest-value reads: fetchLatestMetrics ORDER BY teo DESC';
