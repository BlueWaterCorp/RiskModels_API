-- ERM3 security_master pipeline includes edgar_company_name (SEC EDGAR
-- company-profile enrichment); sync uses SELECT * and REST upsert.
-- PostgREST rejects unknown columns (PGRST204) if this is missing.

ALTER TABLE public.security_master
  ADD COLUMN IF NOT EXISTS edgar_company_name TEXT;

COMMENT ON COLUMN public.security_master.edgar_company_name IS
  'Company name as registered with SEC EDGAR; populated from the ERM3 security_master pipeline (company-profile enrichment).';
