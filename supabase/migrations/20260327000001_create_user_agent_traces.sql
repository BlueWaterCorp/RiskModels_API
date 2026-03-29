-- Create user_agent_traces table for Polsia autonomous feedback traces
CREATE TABLE IF NOT EXISTS public.user_agent_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'hedge_recommendation',
    'pri_drift',
    'sector_tilt',
    'drawdown_warning'
  )),
  surface TEXT NOT NULL CHECK (surface IN (
    'FactorExposureTreemapSurface',
    'HedgeRecipeCardSurface',
    'RiskStackedBarsSurface'
  )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'medium', 'high')),
  debug_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_agent_traces_user_id ON public.user_agent_traces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_agent_traces_created_at ON public.user_agent_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_agent_traces_type ON public.user_agent_traces(type);

ALTER TABLE public.user_agent_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own traces"
  ON public.user_agent_traces FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert traces"
  ON public.user_agent_traces FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can delete traces"
  ON public.user_agent_traces FOR DELETE
  TO service_role
  USING (true);

COMMENT ON TABLE public.user_agent_traces IS 'Polsia autonomous feedback traces for mandate drift (hedge, PRI, sector, drawdown)';
COMMENT ON COLUMN public.user_agent_traces.debug_info IS 'Snapshot: current_PRI, current_sector_weights, raw_mandate_at_run, positions_count';

-- Retention: delete traces older than 30 days (run via cron)
-- DELETE FROM public.user_agent_traces WHERE created_at < now() - interval '30 days';
