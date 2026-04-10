-- Returns-decomposition metrics (daily simple returns from ds_erm3_returns_* zarr).
-- Idempotent: safe if columns already exist (e.g. applied in prod or via ERM3).
-- See docs/planning/ERM3_V3_RETURNS_DECOMP_SUPABASE_PROPAGATION.md

ALTER TABLE public.security_history_latest ADD COLUMN IF NOT EXISTS l1_cfr DOUBLE PRECISION;
ALTER TABLE public.security_history_latest ADD COLUMN IF NOT EXISTS l1_rr DOUBLE PRECISION;
ALTER TABLE public.security_history_latest ADD COLUMN IF NOT EXISTS l2_cfr DOUBLE PRECISION;
ALTER TABLE public.security_history_latest ADD COLUMN IF NOT EXISTS l2_rr DOUBLE PRECISION;
ALTER TABLE public.security_history_latest ADD COLUMN IF NOT EXISTS l3_cfr DOUBLE PRECISION;
ALTER TABLE public.security_history_latest ADD COLUMN IF NOT EXISTS l3_rr DOUBLE PRECISION;
