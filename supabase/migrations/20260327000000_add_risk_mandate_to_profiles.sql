-- Add risk_mandate JSONB column for Sovereign Risk Agent
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS risk_mandate JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_profiles_risk_mandate ON public.profiles USING GIN (risk_mandate);

COMMENT ON COLUMN public.profiles.risk_mandate IS 'User risk mandate (version, tolerance, horizon, PRI range, sectors, hedge preference, discovery_complete, etc.)';

-- RPC: update_risk_mandate
CREATE OR REPLACE FUNCTION public.update_risk_mandate(p_user_id UUID, p_mandate JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET risk_mandate = p_mandate, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- RPC: get_risk_mandate
CREATE OR REPLACE FUNCTION public.get_risk_mandate(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mandate JSONB;
BEGIN
  SELECT risk_mandate INTO v_mandate FROM public.profiles WHERE id = p_user_id;
  RETURN COALESCE(v_mandate, '{}'::jsonb);
END;
$$;
