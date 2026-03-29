-- =====================================================
-- security_history_latest - Latest Metrics Summary
-- =====================================================
--
-- Pipeline-maintained snapshot of latest complete metrics per symbol.
-- Used by dashboard cards, ticker tape, treemap, holdings enrichment.
-- Avoids scanning security_history for latest date on each request.
--
-- Pipeline upserts after daily security_history writes.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.security_history_latest (
  symbol        TEXT NOT NULL,
  periodicity   TEXT NOT NULL DEFAULT 'daily',
  teo           DATE NOT NULL,
  returns_gross FLOAT8,
  vol_23d       FLOAT8,
  price_close   FLOAT8,
  market_cap    FLOAT8,
  l3_mkt_hr     FLOAT8,
  l3_sec_hr     FLOAT8,
  l3_sub_hr     FLOAT8,
  l3_mkt_er     FLOAT8,
  l3_sec_er     FLOAT8,
  l3_sub_er     FLOAT8,
  l3_res_er     FLOAT8,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (symbol, periodicity)
);

CREATE INDEX idx_security_history_latest_periodicity
  ON public.security_history_latest (periodicity);

COMMENT ON TABLE public.security_history_latest IS
'Pipeline-maintained latest metrics per symbol. Populated after daily security_history writes.';

GRANT SELECT ON public.security_history_latest TO anon, authenticated;
