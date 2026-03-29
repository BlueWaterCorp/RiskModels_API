-- =====================================================
-- trading_calendar - Canonical Trading Dates
-- =====================================================
--
-- Pipeline-maintained list of trading dates.
-- Replaces mining distinct dates from security_history at request time.
--
-- Pipeline appends new dates as part of daily writes.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.trading_calendar (
  teo         DATE NOT NULL,
  periodicity TEXT NOT NULL DEFAULT 'daily',
  PRIMARY KEY (teo, periodicity)
);

CREATE INDEX idx_trading_calendar_teo ON public.trading_calendar (teo);
CREATE INDEX idx_trading_calendar_periodicity_teo ON public.trading_calendar (periodicity, teo);

COMMENT ON TABLE public.trading_calendar IS
'Pipeline-maintained trading calendar. Populated after daily security_history writes.';

GRANT SELECT ON public.trading_calendar TO anon, authenticated;
