-- Create symbols view as an alias for ticker_factor_metrics
-- This provides backward compatibility for all existing queries

-- First drop the empty symbols table if it exists (we'll replace with a view)
DROP TABLE IF EXISTS public.symbols CASCADE;

-- Create symbols view that exposes all ticker_factor_metrics columns
CREATE VIEW public.symbols AS
SELECT
  id,
  ticker,
  COALESCE(symbol, ticker) as symbol,
  date,
  volatility,
  sharpe_ratio,
  l1_market_hr,
  l1_market_er,
  l1_residual_er,
  l2_market_hr,
  l2_sector_hr,
  l2_market_er,
  l2_sector_er,
  l2_residual_er,
  l3_market_hr,
  l3_sector_hr,
  l3_subsector_hr,
  l3_market_er,
  l3_sector_er,
  l3_subsector_er,
  l3_residual_er,
  bw_sector_code,
  fs_sector_code,
  fs_industry_code,
  market_cap,
  close_price,
  created_at,
  updated_at,
  type,
  l1_market_fb,
  l2_sector_fb,
  l3_subsector_fb,
  l2_market_fb,
  l3_market_fb,
  l3_sector_fb,
  market_factor_etf
FROM public.ticker_factor_metrics;

-- Grant public read access
GRANT SELECT ON public.symbols TO anon;
GRANT SELECT ON public.symbols TO authenticated;

-- Also create symbols_free view for limited access (L1 only)
DROP VIEW IF EXISTS public.symbols_free;

CREATE VIEW public.symbols_free AS
SELECT
  ticker,
  symbol,
  date,
  volatility,
  sharpe_ratio,
  l1_market_hr,
  l1_market_er
FROM public.symbols;

-- Grant public read access
GRANT SELECT ON public.symbols_free TO anon;
GRANT SELECT ON public.symbols_free TO authenticated;

COMMENT ON VIEW public.symbols IS 'View exposing all ticker_factor_metrics data for backward compatibility';
COMMENT ON VIEW public.symbols_free IS 'Public view with L1 market-level data only';
