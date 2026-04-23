-- =====================================================
-- Mag7 Yearly Contributions — Pre-computed Landing-Page Cache
-- =====================================================
--
-- Feeds the .app landing "Mag7 hero" component (2y + YTD cumulative lines
-- + yt-2 / yt-1 / ytd stacked contribution bars).
--
-- One row per (ticker, calendar_year). Contributions are compounded from
-- daily *_fr / l3_rr series and satisfy (approximately):
--   (1 + gross) ≈ (1 + l1_contrib)(1 + l2_contrib)(1 + l3_contrib)(1 + residual_contrib)
-- so the stacked bars compound to the gross return for that year.
--
-- Populated by the Python backfill script
-- `scripts/backfill_mag7_yearly_contributions.py` and kept fresh by the
-- ERM3 daily pipeline (incremental upsert against the current calendar
-- year only).
--
-- Retention: last 3 calendar years per ticker (yt-2, yt-1, ytd).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.erm3_mag7_yearly_contributions (
  ticker             TEXT NOT NULL,
  calendar_year      INT  NOT NULL,
  l1_contrib         FLOAT8,  -- market factor return, compounded over the year
  l2_contrib         FLOAT8,  -- sector-on-top factor return, compounded
  l3_contrib         FLOAT8,  -- subsector-on-top factor return, compounded
  residual_contrib   FLOAT8,  -- residual (l3_rr), compounded
  gross_contrib      FLOAT8,  -- full-year gross return (for validation: ≈ product of the four legs)
  n_days             INT,     -- number of trading days aggregated (sanity check)
  data_as_of         DATE,    -- last trading day covered by this row
  updated_at         TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (ticker, calendar_year)
);

CREATE INDEX IF NOT EXISTS idx_mag7_contrib_year
  ON public.erm3_mag7_yearly_contributions (calendar_year DESC);

COMMENT ON TABLE public.erm3_mag7_yearly_contributions IS
'Mag7 landing hero: yearly compounded return contributions by ERM3 L3 component (market/sector/subsector/residual). Feeds the stacked bars on the .app landing page. Populated by backfill script + daily pipeline.';

COMMENT ON COLUMN public.erm3_mag7_yearly_contributions.l1_contrib IS
'Market factor (L1) contribution for the calendar year, compounded from daily l1_fr: prod(1 + l1_fr) - 1.';

COMMENT ON COLUMN public.erm3_mag7_yearly_contributions.l2_contrib IS
'Sector-on-top (L2) contribution: prod(1 + l2_fr) - 1. Incremental over L1.';

COMMENT ON COLUMN public.erm3_mag7_yearly_contributions.l3_contrib IS
'Subsector-on-top (L3) contribution: prod(1 + l3_fr) - 1. Incremental over L1+L2.';

COMMENT ON COLUMN public.erm3_mag7_yearly_contributions.residual_contrib IS
'Residual (l3_rr) contribution: prod(1 + l3_rr) - 1. Closes the bars to gross.';

GRANT SELECT ON public.erm3_mag7_yearly_contributions TO anon, authenticated;
