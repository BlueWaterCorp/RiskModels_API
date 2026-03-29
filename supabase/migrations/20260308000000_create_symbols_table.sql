-- Replace symbols view with proper V2 schema table
-- ERM3 pipeline will push data directly into this table
-- security_history (already exists, empty) receives time-series data

BEGIN;

-- Drop dependent views first
DROP VIEW IF EXISTS public.symbols_free CASCADE;
DROP VIEW IF EXISTS public.symbols CASCADE;

-- Create asset_type enum if not already present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_type') THEN
    CREATE TYPE asset_type AS ENUM ('stock', 'etf', 'index');
  END IF;
END $$;

-- Create symbols table (master symbol registry)
CREATE TABLE public.symbols (
  symbol      text PRIMARY KEY,           -- FactSet symbol ID (FSYM_XXXXX) or ticker for simple cases
  ticker      text NOT NULL,              -- Human-readable ticker (AAPL, SPY, etc.)
  asset_type  asset_type NOT NULL DEFAULT 'stock',
  latest_teo  date,                       -- Most recent trading date with data
  latest_vol  real,                       -- Latest volatility estimate
  latest_er_total real,                   -- Latest total explained risk (%)
  latest_hr_mkt   real,                   -- Latest market hedge ratio
  latest_metrics  jsonb DEFAULT '{}'::jsonb,  -- Additional latest metric snapshot
  metadata        jsonb DEFAULT '{}'::jsonb,  -- Static metadata: company_name, sector, industry, sector_etf
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_symbols_ticker       ON public.symbols(ticker);
CREATE INDEX idx_symbols_asset_type   ON public.symbols(asset_type);
CREATE INDEX idx_symbols_latest_teo   ON public.symbols(latest_teo DESC NULLS LAST);
CREATE INDEX idx_symbols_latest_er    ON public.symbols(latest_er_total DESC NULLS LAST);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_symbols_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_symbols_updated_at
  BEFORE UPDATE ON public.symbols
  FOR EACH ROW EXECUTE FUNCTION update_symbols_updated_at();

-- RLS
ALTER TABLE public.symbols ENABLE ROW LEVEL SECURITY;

-- Public read (free tier — ticker + asset_type + latest summary only)
DROP POLICY IF EXISTS "allow_anon_read_symbols" ON public.symbols;
CREATE POLICY "allow_anon_read_symbols"
  ON public.symbols FOR SELECT TO anon USING (true);

-- Authenticated read (full row)
DROP POLICY IF EXISTS "allow_auth_read_symbols" ON public.symbols;
CREATE POLICY "allow_auth_read_symbols"
  ON public.symbols FOR SELECT TO authenticated USING (true);

-- Service role write
DROP POLICY IF EXISTS "allow_service_write_symbols" ON public.symbols;
CREATE POLICY "allow_service_write_symbols"
  ON public.symbols FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.symbols TO anon, authenticated;

-- symbols_free: public subset (L1 summary only, no full metrics/metadata)
CREATE VIEW public.symbols_free AS
SELECT
  symbol,
  ticker,
  asset_type,
  latest_teo,
  latest_vol,
  latest_er_total,
  latest_hr_mkt
FROM public.symbols;

GRANT SELECT ON public.symbols_free TO anon, authenticated;

COMMENT ON TABLE public.symbols IS
  'Master symbol registry. PK is symbol (FactSet ID or ticker). ERM3 pipeline upserts rows here. '
  'For time-series data see security_history.';
COMMENT ON VIEW public.symbols_free IS 'Public subset: summary columns only, no full metrics or metadata JSONB.';

COMMIT;
