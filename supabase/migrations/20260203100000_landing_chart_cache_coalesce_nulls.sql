-- =====================================================
-- Landing Chart Cache: Harden against NULL daily returns
-- =====================================================
--
-- Problem: Zarr has correct daily returns (e.g. NFLX 2023-02-03), but if
-- erm3_ticker_returns has a missing row or NULL in gross_return/l1/l2/l3,
-- LN(1 + NULL) = NULL and the cumulative for that row becomes NULL, which
-- the app displays as 0% and causes a spurious drop in the chart.
--
-- Fix: Coalesce NULL daily returns to 0 in the view so the cumulative
-- series stays continuous (treat that day as 0% return rather than "unknown").
-- This does not fix missing rows — the backfill/sync must populate
-- erm3_ticker_returns from Zarr. If zeros persist, check:
--   SELECT date, gross_return, l1, l2, l3 FROM erm3_ticker_returns
--   WHERE ticker = 'NFLX' AND date = '2023-02-03';
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
'Pre-cached data for landing page chart. Contains top 10 tickers for last 3 years (~7.5K rows). NULL daily returns are coalesced to 0 so cumulative series stay continuous. Refresh: REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;';

GRANT SELECT ON erm3_landing_chart_cache TO anon, authenticated;

REFRESH MATERIALIZED VIEW erm3_landing_chart_cache;
