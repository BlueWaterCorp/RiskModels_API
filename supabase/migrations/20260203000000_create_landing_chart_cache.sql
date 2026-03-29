-- =====================================================
-- Landing Page Chart Cache - Materialized View
-- =====================================================
-- 
-- Purpose: Pre-cache exactly the data needed for landing page chart
-- - Top 10 popular tickers
-- - Last 3 years of daily returns
-- - ~7,500 rows total (750 days × 10 tickers)
-- 
-- Performance: ~10ms query vs ~500ms filtered query
-- Storage: ~500KB vs scanning millions of rows
-- 
-- Refresh: Run daily via cron or after data sync
-- =====================================================

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS erm3_landing_chart_cache CASCADE;

-- Create materialized view with PRE-COMPUTED cumulative returns
-- This eliminates client-side calculation for instant ticker switching
CREATE MATERIALIZED VIEW erm3_landing_chart_cache AS
WITH daily_data AS (
  SELECT 
    tr.ticker,
    tr.date,
    tr.gross_return,
    tr.l1,
    tr.l2,
    tr.l3,
    COALESCE(tm.sector_etf, 'SPY') as sector_etf,
    COALESCE(tm.subsector_etf, tm.sector_etf, 'SPY') as subsector_etf,
    ROW_NUMBER() OVER (PARTITION BY tr.ticker ORDER BY tr.date) as row_num
  FROM erm3_ticker_returns tr
  LEFT JOIN ticker_metadata tm ON tr.ticker = tm.ticker
  WHERE tr.ticker IN ('NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD', 'NFLX', 'JPM')
    AND tr.date >= CURRENT_DATE - INTERVAL '3 years'
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
    END as cum_stock,
    CASE 
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + l1)) OVER (
        PARTITION BY ticker 
        ORDER BY date 
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END as cum_market,
    CASE 
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + l2)) OVER (
        PARTITION BY ticker 
        ORDER BY date 
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END as cum_sector,
    CASE 
      WHEN row_num = 1 THEN 0.0
      ELSE (EXP(SUM(LN(1 + l3)) OVER (
        PARTITION BY ticker 
        ORDER BY date 
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) - 1.0) * 100.0
    END as cum_subsector
  FROM daily_data
)
SELECT * FROM cumulative
ORDER BY date ASC, ticker ASC;

-- Create index for fast lookups (though full table scan will be fast enough)
CREATE INDEX idx_landing_cache_ticker_date ON erm3_landing_chart_cache (ticker, date);
CREATE INDEX idx_landing_cache_date ON erm3_landing_chart_cache (date);

-- Add comment for documentation
COMMENT ON MATERIALIZED VIEW erm3_landing_chart_cache IS 
'Pre-cached data for landing page chart. Contains top 10 tickers for last 3 years (~7.5K rows). 
Refresh daily: REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;';

-- Grant read access to anon/authenticated users (RLS doesn't apply to materialized views)
GRANT SELECT ON erm3_landing_chart_cache TO anon, authenticated;

-- Initial refresh to populate the view
REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;

-- =====================================================
-- Refresh Function (Optional - for automated refresh)
-- =====================================================

-- Function to refresh the cache
CREATE OR REPLACE FUNCTION refresh_landing_chart_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;
  RAISE NOTICE 'Landing chart cache refreshed successfully';
END;
$$;

COMMENT ON FUNCTION refresh_landing_chart_cache() IS 
'Refreshes the landing page chart cache. Call this after syncing new data to erm3_ticker_returns.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION refresh_landing_chart_cache() TO service_role;
