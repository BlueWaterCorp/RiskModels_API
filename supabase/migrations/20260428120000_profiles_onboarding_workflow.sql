-- Canonical copy (riskmodels.app + portal migrations): RiskModels_API/supabase/migrations/.
-- Mirrors riskmodels_net: Risk_Models/riskmodels_com/supabase/migrations/ (same filename).
-- User developer-onboarding preference for email copy, in-app defaults, and analytics.
-- Extends existing public.profiles (RLS: users already SELECT/UPDATE own row; no new policies needed).
-- Apply with: supabase db push (or link + push from your environment).

-- Allowed values (text + CHECK keeps enum changes to one-line migrations vs ALTER TYPE).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_workflow text
    CHECK (
      onboarding_workflow IS NULL
      OR onboarding_workflow IN (
        'agent',      -- MCP / Cursor / Claude / Codex / VS Code installer path
        'python',     -- pip riskmodels-py, notebooks, Colab
        'cli',        -- npm global riskmodels CLI
        'raw_api',    -- REST / curl / hand-rolled HTTP only
        'unsure'      -- short chooser content; user can refine later
      )
    );

COMMENT ON COLUMN public.profiles.onboarding_workflow IS
  'Self-reported developer path for onboarding emails and UI. NULL = not chosen yet.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_workflow_set_at timestamptz;

COMMENT ON COLUMN public.profiles.onboarding_workflow_set_at IS
  'When onboarding_workflow was last set or changed; NULL if never set.';

-- Keep set_at in sync (INSERT with a value, UPDATE when the choice changes)
CREATE OR REPLACE FUNCTION public.profiles_onboarding_workflow_set_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.onboarding_workflow IS NOT NULL THEN
      NEW.onboarding_workflow_set_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.onboarding_workflow IS DISTINCT FROM OLD.onboarding_workflow THEN
    NEW.onboarding_workflow_set_at := CASE
      WHEN NEW.onboarding_workflow IS NULL THEN NULL
      ELSE now()
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_onboarding_workflow_set_at ON public.profiles;
CREATE TRIGGER profiles_onboarding_workflow_set_at
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_onboarding_workflow_set_at();

-- Optional: targeted reads for campaigns (low cardinality)
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_workflow
  ON public.profiles (onboarding_workflow)
  WHERE onboarding_workflow IS NOT NULL;
