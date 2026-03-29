-- Append-only log of ERM3 sync runs for introspection and debugging.
-- Replaces "scroll through terminal output" with queryable history.
-- See: .cursor/plans/fix_erm3_supabase_sync_ed141fa4.plan.md

CREATE TABLE IF NOT EXISTS public.erm3_sync_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER GENERATED ALWAYS AS (
    (EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::INTEGER
  ) STORED,

  -- What ran
  sync_source   TEXT NOT NULL,  -- 'run_sync', 'load_csv', 'update_landing_cache_only', 'manual'
  market_factor_etf TEXT,
  universe      TEXT,
  lookback      INTEGER,       -- 0 = full history, N = last N days
  datasets      TEXT[],        -- {'daily','etf','hedge_weights','betas','rankings','security_master'}

  -- Results per dataset (JSONB for flexibility)
  results       JSONB NOT NULL DEFAULT '{}',
  -- Example: {"daily_records": 15000, "etf_records": 2400, "landing_cache": 16500,
  --           "symbols": 3200, "security_history_latest": 3000, "trading_calendar": 750}

  -- Outcome
  status        TEXT NOT NULL DEFAULT 'running',  -- 'running', 'success', 'partial', 'error'
  error_message TEXT,
  warnings      TEXT[],        -- Non-fatal issues: ['GOOGL not in symbols', 'limit hit on query X']

  -- Row count verification (spot-check after write)
  verify_counts JSONB,
  -- Example: {"security_history_daily_max_teo": "2026-03-13",
  --           "landing_cache_rows": 16500, "landing_cache_max_date": "2026-03-13"}

  -- Metadata
  hostname      TEXT,          -- Which machine ran this
  python_version TEXT,
  supabase_py_version TEXT
);

-- Index for quick lookups
CREATE INDEX idx_sync_log_started ON public.erm3_sync_log (started_at DESC);
CREATE INDEX idx_sync_log_source  ON public.erm3_sync_log (sync_source, started_at DESC);
CREATE INDEX idx_sync_log_status  ON public.erm3_sync_log (status) WHERE status != 'success';

-- RLS: admin-only read, service-role write (no policy for INSERT/UPDATE - service role bypasses RLS)
ALTER TABLE public.erm3_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read sync log" ON public.erm3_sync_log
  FOR SELECT USING (
    auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')
  );

COMMENT ON TABLE public.erm3_sync_log IS 'Append-only log of ERM3 sync runs. Retained 90 days. Prune via cron or manual DELETE.';
