-- =====================================================
-- Landing Page Chart Cache - Pipeline-Maintained Table
-- =====================================================
--
-- Replaces materialized view with a plain table populated by the ERM3 pipeline.
-- Avoids full refresh over 313M-row security_history; pipeline upserts incrementally.
--
-- Columns match preload-chart-data.ts contract exactly.
-- Retention: pipeline keeps last 3 years only.
-- =====================================================

-- Drop materialized view and refresh function
DROP FUNCTION IF EXISTS refresh_landing_chart_cache() CASCADE;
DROP MATERIALIZED VIEW IF EXISTS erm3_landing_chart_cache CASCADE;

-- Create plain table (pipeline upserts, app reads)
CREATE TABLE public.erm3_landing_chart_cache (
  ticker        TEXT NOT NULL,
  date          DATE NOT NULL,
  sector_etf    TEXT,
  subsector_etf TEXT,
  cum_stock     FLOAT8,
  cum_market    FLOAT8,
  cum_sector    FLOAT8,
  cum_subsector FLOAT8,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (ticker, date)
);

CREATE INDEX idx_landing_cache_date ON public.erm3_landing_chart_cache (date);

COMMENT ON TABLE public.erm3_landing_chart_cache IS
'Pipeline-maintained landing page chart cache. Top 10 tickers, last 3 years, pre-computed cumulative returns. Pipeline upserts after daily security_history writes.';

GRANT SELECT ON public.erm3_landing_chart_cache TO anon, authenticated;
