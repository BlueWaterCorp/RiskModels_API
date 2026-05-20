-- Mirror: Risk_Models/riskmodels_com/supabase/migrations/20260517110000_profiles_complimentary_professional_until.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS complimentary_professional_until timestamptz NULL;

COMMENT ON COLUMN public.profiles.complimentary_professional_until IS
  'When complimentary_professional is true: access ends after this instant (UTC). NULL = open-ended until revoked.';
