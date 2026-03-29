-- =====================================================
-- security_history Performance Indexes (Part 2 of 3)
-- =====================================================
--
-- MANUAL RUN REQUIRED. In SQL Editor: SET statement_timeout = '60min'; then:
--
-- Time-series reads: fetchHistory, fetchBatchHistory
-- =====================================================

/*
SET statement_timeout = '60min';

CREATE INDEX IF NOT EXISTS idx_security_history_symbol_period_metric_teo
  ON public.security_history (symbol, periodicity, metric_key, teo);

COMMENT ON INDEX idx_security_history_symbol_period_metric_teo IS
  'Time-series reads: fetchHistory, fetchBatchHistory';
*/

SELECT 1;
