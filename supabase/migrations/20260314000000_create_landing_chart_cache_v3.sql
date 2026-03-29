-- =====================================================
-- Landing Page Chart Cache V3 - Materialized View
-- =====================================================
--
-- Purpose: Pre-cache landing page chart data from V3 schema
-- - Top 10 popular tickers (NVDA, AAPL, MSFT, TSLA, AMZN, GOOGL, META, AMD, NFLX, JPM)
-- - Last 3 years of daily returns
-- - ~7,500 rows total (750 days × 10 tickers)
--
-- Performance: ~10ms query vs ~500ms live pivot query
-- Storage: ~500KB vs scanning millions of security_history rows
--
-- Dependencies: security_history (V3), symbols (V3)
--
-- Refresh: Call after daily Python Dagster pipeline completes
-- =====================================================

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS erm3_landing_chart_cache CASCADE;

-- Create materialized view with PRE-COMPUTED cumulative returns
-- Pivots long-form security_history into wide format for fast reads
CREATE MATERIALIZED VIEW erm3_landing_chart_cache AS
WITH daily_metrics AS (
  -- Pivot long-form security_history to wide format
  SELECT
    sh.symbol,
    sh.teo AS date,
    MAX(CASE WHEN sh.metric_key = 'returns_gross' THEN sh.metric_value END) AS gross_return,
    MAX(CASE WHEN sh.metric_key = 'l1_mkt_hr' THEN sh.metric_value END) AS l1,
    MAX(CASE WHEN sh.metric_key = 'l2_mkt_hr' THEN sh.metric_value END) AS l2,
    MAX(CASE WHEN sh.metric_key = 'l3_mkt_hr' THEN sh.metric_value END) AS l3,
    MAX(CASE WHEN sh.metric_key = 'l3_sec_hr' THEN sh.metric_value END) AS sec_hr,
    ROW_NUMBER() OVER (PARTITION BY sh.symbol ORDER BY sh.teo) AS row_num
  FROM security_history sh
  WHERE sh.periodicity = 'daily'
    AND sh.symbol IN (
      'NVDA.US', 'AAPL.US', 'MSFT.US', 'TSLA.US', 'AMZN.US',
      'GOOGL.US', 'META.US', 'AMD.US', 'NFLX.US', 'JPM.US'
    )
    AND sh.teo >= CURRENT_DATE - INTERVAL '3 years'
  GROUP BY sh.symbol, sh.teo
),
daily_data AS (
  SELECT
    s.ticker,
    dm.date,
    COALESCE(dm.gross_return, 0) AS gross_return,
    COALESCE(dm.l1, 0) AS l1,
    COALESCE(dm.l2, 0) AS l2,
    COALESCE(dm.l3, 0) AS l3,
    COALESCE(s.sector_etf, 'SPY') AS sector_etf,
    -- Subsector lookup would require additional table; fallback to sector_etf
    COALESCE(s.sector_etf, 'SPY') AS subsector_etf,
    dm.row_num
  FROM daily_metrics dm
  JOIN symbols s ON dm.symbol = s.symbol
),
cumulative AS (
  SELECT
    ticker,
    date,
    sector_etf,
    subsector_etf,
    -- Pre-compute cumulative returns using vectorized window functions
    -- Formula: cumulative = PRODUCT(1 + daily_return) - 1
    -- PostgreSQL: EXP(SUM(LN(1 + return))) - 1
    CASE
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + gross_return)) OVER (
        PARTITION BY ticker
        ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END AS cum_stock,
    CASE
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + l1)) OVER (
        PARTITION BY ticker
        ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END AS cum_market,
    CASE
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + l2)) OVER (
        PARTITION BY ticker
        ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END AS cum_sector,
    CASE
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + l3)) OVER (
        PARTITION BY ticker
        ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END AS cum_subsector
  FROM daily_data
)
SELECT * FROM cumulative
ORDER BY date ASC, ticker ASC;

-- Create indexes for fast lookups
CREATE INDEX idx_landing_cache_ticker_date ON erm3_landing_chart_cache (ticker, date);
CREATE INDEX idx_landing_cache_date ON erm3_landing_chart_cache (date);

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_landing_cache_ticker_date_unique
  ON erm3_landing_chart_cache (ticker, date);

-- Add comment for documentation
COMMENT ON MATERIALIZED VIEW erm3_landing_chart_cache IS
'Pre-cached data for landing page chart (V3 schema). Contains top 10 tickers for last 3 years (~7.5K rows).
Source: security_history (pivoted from long-form V3 schema).
Refresh: SELECT refresh_landing_chart_cache();';

-- Grant read access to anon/authenticated users (RLS doesn't apply to materialized views)
GRANT SELECT ON erm3_landing_chart_cache TO anon, authenticated;

-- =====================================================
-- Refresh Function with CONCURRENTLY support
-- =====================================================

-- Function to refresh the cache (non-blocking with CONCURRENTLY)
CREATE OR REPLACE FUNCTION refresh_landing_chart_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY erm3_landing_chart_cache;
  RAISE NOTICE 'Landing chart cache refreshed successfully (V3)';
END;
$$;

COMMENT ON FUNCTION refresh_landing_chart_cache() IS
'Refreshes the landing page chart cache CONCURRENTLY (non-blocking). Call this after security_history is updated by the Python pipeline.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION refresh_landing_chart_cache() TO service_role;

-- =====================================================
-- Initial population
-- =====================================================

REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;
