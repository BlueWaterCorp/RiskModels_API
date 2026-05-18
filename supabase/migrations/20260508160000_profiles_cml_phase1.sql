-- Canonical copy (riskmodels.app + portal): RiskModels_API/supabase/migrations/.
-- Mirrors riskmodels.net: Risk_Models/riskmodels_com/supabase/migrations/ (same filename).
--
-- Phase 1 Client Memory Layer MVP (profiles extension). See Risk_Models
-- docs/architecture/client_memory_layer.md and BWMACRO net_activation_and_cml_phase1.md.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_workflow text
    CHECK (
      primary_workflow IS NULL
      OR primary_workflow IN (
        'hedge_portfolio',
        'explain_factor_exposure',
        'monitor_benchmark_relative_risk',
        'prepare_pm_review'
      )
    );

COMMENT ON COLUMN public.profiles.primary_workflow IS
  'Product workflow driving adaptive workspace on riskmodels.net (CML MVP).';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cml_activation_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.cml_activation_state IS
  'CML Phase 1 JSON: last activation portfolio subset, snapshot lineage refs, timestamps.';
