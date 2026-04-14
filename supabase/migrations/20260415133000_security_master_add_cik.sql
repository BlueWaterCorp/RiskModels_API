-- ERM3 security_master SQLite includes cik; sync uses SELECT * and REST upsert.
-- PostgREST rejects unknown columns (PGRST204) if this is missing.

ALTER TABLE public.security_master
  ADD COLUMN IF NOT EXISTS cik TEXT;

CREATE INDEX IF NOT EXISTS idx_security_master_cik
  ON public.security_master (cik)
  WHERE cik IS NOT NULL;

COMMENT ON COLUMN public.security_master.cik IS
  'SEC Central Index Key; populated from ERM3 security_master pipeline.';
