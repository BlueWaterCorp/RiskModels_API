-- Mirror of canonical: Risk_Models/riskmodels_com/supabase/migrations/20260517100000_profiles_complimentary_professional.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS complimentary_professional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.complimentary_professional IS
  'When true, riskmodels.net treats the user as active professional without billing.';

CREATE INDEX IF NOT EXISTS idx_profiles_complimentary_professional
  ON public.profiles (complimentary_professional)
  WHERE complimentary_professional = true;
