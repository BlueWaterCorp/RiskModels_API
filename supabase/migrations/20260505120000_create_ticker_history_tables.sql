-- Ticker history mirror (C.1' — historical-ticker recall, FB→META).
-- Mirrors ERM3/data/stock_data/eodhd/eodhd_extractions.db tables
-- ticker_change_history and security_aliases. Service-role only on Supabase.
--
-- Supports `resolveSymbolByTicker` extension: an arbitrary ticker
-- (current or historical) resolves to canonical `bw_sym_id`, and the zarr
-- loader returns the continuous return series across rename spans.
--
-- Architecture: ERM3 SQLite is the source of truth; this Supabase mirror
-- gives the API a single read path that doesn't require shipping the
-- SQLite file to API runtimes. Sync function lives in
-- ERM3/scripts/python/sync_erm3_to_supabase_v3.py
-- (sync_ticker_history_from_sqlite). Per CEO call 2026-05-05, the mirror
-- is the long-term architecture vs. an in-process JSON cache.

-- ---------------------------------------------------------------------
-- public.ticker_change_history
-- One row per rename event (e.g. FB → META on 2022-06-09).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticker_change_history (
  id BIGINT PRIMARY KEY,
  bw_sym_id TEXT NOT NULL,
  old_ticker TEXT NOT NULL,
  new_ticker TEXT NOT NULL,
  change_date DATE NOT NULL,
  effective_date DATE,
  source TEXT,
  confidence_score REAL DEFAULT 1.0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticker_change_history_bw_sym_id
  ON public.ticker_change_history(bw_sym_id);
CREATE INDEX IF NOT EXISTS idx_ticker_change_history_old_ticker
  ON public.ticker_change_history(old_ticker);
CREATE INDEX IF NOT EXISTS idx_ticker_change_history_new_ticker
  ON public.ticker_change_history(new_ticker);

ALTER TABLE public.ticker_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticker_change_history_service_role_only"
  ON public.ticker_change_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.ticker_change_history IS
  'Mirror of ERM3 eodhd_extractions.db.ticker_change_history. One row per ticker rename event. '
  'Service-role only. Used by API resolveSymbolByTicker for historical-ticker recall (FB→META).';

-- ---------------------------------------------------------------------
-- public.security_aliases
-- Time-bounded alias table: each row is one (alias_type, alias_value)
-- valid for a `bw_sym_id` over [valid_from, valid_to). Captures both
-- legs of a rename (e.g. FB 2012-05-18 → 2022-06-09; META 2022-06-09 → ∞)
-- and per-source observed spans (FINRA / EODHD).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.security_aliases (
  id BIGINT PRIMARY KEY,
  bw_sym_id TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  source_system TEXT,
  confidence_score REAL DEFAULT 1.0,
  is_primary BOOLEAN DEFAULT FALSE,
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  alias_metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_security_aliases_bw_sym_id
  ON public.security_aliases(bw_sym_id);
CREATE INDEX IF NOT EXISTS idx_security_aliases_alias_value
  ON public.security_aliases(alias_value);
CREATE INDEX IF NOT EXISTS idx_security_aliases_type_value
  ON public.security_aliases(alias_type, alias_value);
-- Ticker-resolution hot path: lookup by ticker value, narrow by type.
CREATE INDEX IF NOT EXISTS idx_security_aliases_ticker_resolution
  ON public.security_aliases(alias_value, alias_type)
  WHERE alias_type IN ('TICKER', 'EODHD_TICKER', 'FINRA_TICKER');

ALTER TABLE public.security_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "security_aliases_service_role_only"
  ON public.security_aliases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.security_aliases IS
  'Mirror of ERM3 eodhd_extractions.db.security_aliases. Time-bounded alias rows '
  '(TICKER/EODHD_TICKER/FINRA_TICKER/...) per bw_sym_id. Service-role only. '
  'Used by API resolveSymbolByTicker for historical-ticker recall.';
