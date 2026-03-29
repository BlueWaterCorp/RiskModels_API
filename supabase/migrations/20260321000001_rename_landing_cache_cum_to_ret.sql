-- =====================================================
-- Rename cum_* columns to ret_* in erm3_landing_chart_cache
-- =====================================================
--
-- Reason: columns now store raw daily returns_gross (decimal) rather than
-- pre-computed cumulative returns. Frontend accumulates for any start date.
-- Naming aligns with security_history metric_key convention (returns_gross)
-- to enable bridging to that table for histories > 3y.
-- =====================================================

ALTER TABLE public.erm3_landing_chart_cache
  RENAME COLUMN cum_stock     TO ret_stock;
ALTER TABLE public.erm3_landing_chart_cache
  RENAME COLUMN cum_market    TO ret_market;
ALTER TABLE public.erm3_landing_chart_cache
  RENAME COLUMN cum_sector    TO ret_sector;
ALTER TABLE public.erm3_landing_chart_cache
  RENAME COLUMN cum_subsector TO ret_subsector;

COMMENT ON TABLE public.erm3_landing_chart_cache IS
'Pipeline-maintained landing page chart cache. Top 10 tickers, last 3 years, raw daily returns_gross (decimal). Frontend accumulates into cumulative % for any start date.';
