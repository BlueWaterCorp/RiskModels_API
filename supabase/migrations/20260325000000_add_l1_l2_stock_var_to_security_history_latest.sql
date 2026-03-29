-- Add L1, L2, and stock_var columns to security_history_latest (V3 full data delivery)
-- See: docs/supabase/V3_DATA_CONTRACT.md
-- Creates table if missing (e.g. fresh DB), then adds new columns.

CREATE TABLE IF NOT EXISTS public.security_history_latest (
  symbol        TEXT NOT NULL,
  periodicity   TEXT NOT NULL DEFAULT 'daily',
  teo           DATE NOT NULL,
  returns_gross FLOAT8,
  vol_23d       FLOAT8,
  price_close   FLOAT8,
  market_cap    FLOAT8,
  l1_mkt_hr     FLOAT8,
  l1_mkt_er     FLOAT8,
  l1_res_er     FLOAT8,
  l2_mkt_hr     FLOAT8,
  l2_sec_hr     FLOAT8,
  l2_mkt_er     FLOAT8,
  l2_sec_er     FLOAT8,
  l2_res_er     FLOAT8,
  l3_mkt_hr     FLOAT8,
  l3_sec_hr     FLOAT8,
  l3_sub_hr     FLOAT8,
  l3_mkt_er     FLOAT8,
  l3_sec_er     FLOAT8,
  l3_sub_er     FLOAT8,
  l3_res_er     FLOAT8,
  stock_var     FLOAT8,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (symbol, periodicity)
);

-- Add columns only if table already existed (from 20260317000000) without them
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l1_mkt_hr'
  ) THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l1_mkt_hr FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l1_mkt_er') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l1_mkt_er FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l1_res_er') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l1_res_er FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l2_mkt_hr') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l2_mkt_hr FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l2_sec_hr') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l2_sec_hr FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l2_mkt_er') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l2_mkt_er FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l2_sec_er') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l2_sec_er FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'l2_res_er') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN l2_res_er FLOAT8;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'security_history_latest' AND column_name = 'stock_var') THEN
    ALTER TABLE public.security_history_latest ADD COLUMN stock_var FLOAT8;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_security_history_latest_periodicity
  ON public.security_history_latest (periodicity);

COMMENT ON TABLE public.security_history_latest IS
'Pipeline-maintained latest metrics per symbol. Populated after daily security_history writes.';

COMMENT ON COLUMN public.security_history_latest.l1_mkt_hr IS 'L1 market hedge ratio / beta';
COMMENT ON COLUMN public.security_history_latest.l2_mkt_hr IS 'L2 market hedge ratio';
COMMENT ON COLUMN public.security_history_latest.stock_var IS 'Stock-specific variance component';

GRANT SELECT ON public.security_history_latest TO anon, authenticated;
