-- =====================================================
-- Restore erm3_landing_chart_cache for landing page preload
-- =====================================================
--
-- The view was dropped in 20260205000000_fix_subscription_tables_and_cleanup.sql
-- but src/lib/preload-chart-data.ts still queries it for fast landing chart load.
-- This migration recreates it so server-side preload works; if the view is
-- missing, the app falls back to client-side /api/ticker-returns.
--
-- Depends on: erm3_ticker_returns, ticker_metadata (from earlier migrations).
-- =====================================================

DROP MATERIALIZED VIEW IF EXISTS erm3_landing_chart_cache CASCADE;

CREATE MATERIALIZED VIEW erm3_landing_chart_cache AS
WITH daily_data AS (
  SELECT 
    tr.ticker,
    tr.date,
    COALESCE(tr.gross_return, 0) AS gross_return,
    COALESCE(tr.l1, 0) AS l1,
    COALESCE(tr.l2, 0) AS l2,
    COALESCE(tr.l3, 0) AS l3,
    COALESCE(tm.sector_etf, 'SPY') AS sector_etf,
    COALESCE(tm.subsector_etf, tm.sector_etf, 'SPY') AS subsector_etf,
    ROW_NUMBER() OVER (PARTITION BY tr.ticker ORDER BY tr.date) AS row_num
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

CREATE INDEX idx_landing_cache_ticker_date ON erm3_landing_chart_cache (ticker, date);
CREATE INDEX idx_landing_cache_date ON erm3_landing_chart_cache (date);

COMMENT ON MATERIALIZED VIEW erm3_landing_chart_cache IS 
'Pre-cached data for landing page chart. Contains top 10 tickers for last 3 years (~7.5K rows). NULL daily returns coalesced to 0. Refresh: REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;';

GRANT SELECT ON erm3_landing_chart_cache TO anon, authenticated;

REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;
