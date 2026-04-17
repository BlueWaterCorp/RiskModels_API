-- Create erm3_sync_state_v4 — replaces v3 after the pure-Zarr SSOT cutover.
--
-- v3 tracked legacy long-form security_history_* datasets that are no longer
-- written (writes disabled in 515f5d9 — Phase 4 SSOT). v4 tracks only the
-- tables that today's pipeline actually writes, with extended columns for
-- visibility (row_count, write_method, source_dataset, status).
--
-- Seed rows are computed from current table state so the admin dashboard
-- reflects reality immediately, without waiting for the next Dagster run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erm3_sync_state_v4 (
  table_name          text        NOT NULL,
  market_factor_etf   text        NOT NULL DEFAULT 'SPY',
  universe            text        NOT NULL DEFAULT 'GLOBAL',
  max_date            date,
  last_synced_at      timestamptz NOT NULL DEFAULT NOW(),
  row_count           integer,
  write_method        text,
  source_dataset      text,
  status              text        NOT NULL DEFAULT 'ok'
                                  CHECK (status IN ('ok', 'partial', 'failed')),
  error_message       text,
  PRIMARY KEY (table_name, market_factor_etf, universe)
);

COMMENT ON TABLE public.erm3_sync_state_v4 IS
  'Per-table sync state tracking. Replaces erm3_sync_state_v3 after the zarr-SSOT cutover. One row per (table_name, etf, universe).';

-- Seed rows from current table state (idempotent: ON CONFLICT DO UPDATE).
-- NOTE: rows for security_history_latest / symbols_latest use the Zarr SSOT
-- universe (uni_mc_3000); cross-universe tables use GLOBAL.

DO $seed$
DECLARE
  shl_max      date;
  shl_count    integer;
  shlb_count   integer;
  sym_count    integer;
  sym_updated  timestamptz;
  syml_max     date;
  syml_count   integer;
  secm_count   integer;
  secm_updated timestamptz;
  tc_max       date;
  tc_count     integer;
  mf_max       date;
  mf_count     integer;
  lcc_max      date;
  lcc_count    integer;
BEGIN
  -- security_history_latest (core)
  SELECT MAX(teo), COUNT(*) INTO shl_max, shl_count
    FROM public.security_history_latest
    WHERE periodicity = 'daily';
  -- security_history_latest (betas phase) — beta columns are NOT NULL only
  -- on rows touched by load_betas_to_supabase.py.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='security_history_latest'
             AND column_name='l1_mkt_beta') THEN
    SELECT COUNT(*) INTO shlb_count
      FROM public.security_history_latest
      WHERE l1_mkt_beta IS NOT NULL;
  END IF;

  -- symbols (registry)
  SELECT COUNT(*), MAX(updated_at) INTO sym_count, sym_updated
    FROM public.symbols;

  -- symbols_latest_* columns
  SELECT MAX(latest_teo), COUNT(*) INTO syml_max, syml_count
    FROM public.symbols
    WHERE latest_teo IS NOT NULL;

  -- security_master
  SELECT COUNT(*), MAX(updated_at) INTO secm_count, secm_updated
    FROM public.security_master;

  -- trading_calendar
  SELECT MAX(teo), COUNT(*) INTO tc_max, tc_count
    FROM public.trading_calendar
    WHERE periodicity = 'daily';

  -- macro_factors
  SELECT MAX(teo), COUNT(*) INTO mf_max, mf_count
    FROM public.macro_factors;

  -- erm3_landing_chart_cache
  SELECT MAX(date), COUNT(*) INTO lcc_max, lcc_count
    FROM public.erm3_landing_chart_cache;

  INSERT INTO public.erm3_sync_state_v4
    (table_name, market_factor_etf, universe, max_date, last_synced_at, row_count, write_method, source_dataset, status)
  VALUES
    ('security_history_latest',       'SPY', 'uni_mc_3000', shl_max,     COALESCE(sym_updated, NOW()), shl_count,   'zarr_ssot',   'ds_daily.zarr + ds_erm3_*.zarr', 'ok'),
    ('security_history_latest_betas', 'SPY', 'uni_mc_3000', shl_max,     COALESCE(sym_updated, NOW()), shlb_count,  'postgres_copy', 'ds_erm3_betas.zarr',           'ok'),
    ('symbols',                       'SPY', 'GLOBAL',      NULL,        COALESCE(sym_updated, NOW()), sym_count,   'rest_upsert', 'ticker_list + ds_daily.zarr',   'ok'),
    ('symbols_latest',                'SPY', 'uni_mc_3000', syml_max,    COALESCE(sym_updated, NOW()), syml_count,  'rest_upsert', 'security_history_latest rows',  'ok'),
    ('security_master',               'SPY', 'GLOBAL',      NULL,        COALESCE(secm_updated, NOW()), secm_count, 'rest_upsert', 'eodhd_extractions.db',          'ok'),
    ('trading_calendar',              'SPY', 'GLOBAL',      tc_max,      COALESCE(sym_updated, NOW()), tc_count,    'rest_upsert', 'NYSE trading days',             'ok'),
    ('macro_factors',                 'SPY', 'GLOBAL',      mf_max,      COALESCE(sym_updated, NOW()), mf_count,    'rest_upsert', 'ds_macro_factor.zarr',          'ok'),
    ('erm3_landing_chart_cache',      'SPY', 'GLOBAL',      lcc_max,     COALESCE(sym_updated, NOW()), lcc_count,   'rest_upsert', 'security_history_latest',       'ok')
  ON CONFLICT (table_name, market_factor_etf, universe) DO UPDATE SET
    max_date       = EXCLUDED.max_date,
    last_synced_at = EXCLUDED.last_synced_at,
    row_count      = EXCLUDED.row_count,
    write_method   = EXCLUDED.write_method,
    source_dataset = EXCLUDED.source_dataset,
    status         = EXCLUDED.status;
END $seed$;

COMMIT;
