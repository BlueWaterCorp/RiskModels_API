-- =====================================================
-- security_history Performance Indexes (Part 3 of 3)
-- =====================================================
--
-- MANUAL RUN REQUIRED. In SQL Editor: SET statement_timeout = '60min'; then:
--
-- Latest-value reads: fetchLatestMetrics
-- =====================================================

/*
SET statement_timeout = '60min';

CREATE INDEX IF NOT EXISTS idx_security_history_symbol_period_metric_teo_desc
  ON public.security_history (symbol, periodicity, metric_key, teo DESC);

COMMENT ON INDEX idx_security_history_symbol_period_metric_teo_desc IS
  'Latest-value reads: fetchLatestMetrics ORDER BY teo DESC';
*/

SELECT 1;
