-- Internal security_master table (service_role only)
-- Syncs from ERM3 security_master.db for data management, Plaid CUSIP resolution, admin tools.
-- NOT exposed to public API - contains ISIN, CUSIP which may require licensing.
-- RLS: Only service_role can read/write. anon and authenticated have no access.

CREATE TABLE IF NOT EXISTS public.security_master (
  bw_sym_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  isin TEXT,
  cusip TEXT,
  openfigi TEXT,
  fsym_id TEXT,
  sedol TEXT,
  valid_from DATE NOT NULL DEFAULT '2000-01-01',
  valid_to DATE,
  gics_sector_code INTEGER,
  gics_sector_name TEXT,
  gics_industry_group_code INTEGER,
  gics_industry_group_name TEXT,
  gics_industry_code INTEGER,
  gics_industry_name TEXT,
  gics_sub_industry_code INTEGER,
  gics_sub_industry_name TEXT,
  fs_sector_code INTEGER,
  fs_industry_code INTEGER,
  bw_sector_code INTEGER,
  market_etf TEXT,
  sector_etf TEXT,
  subsector_etfs TEXT,
  unique_ticker TEXT,
  is_ticker_fallback BOOLEAN DEFAULT FALSE,
  ticker_recycle_count INTEGER DEFAULT 0,
  asset_type TEXT DEFAULT 'EQUITY',
  exchange TEXT,
  country TEXT,
  currency TEXT DEFAULT 'USD',
  company_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_delisted BOOLEAN DEFAULT FALSE,
  is_adr BOOLEAN DEFAULT FALSE,
  delisted_date DATE,
  metadata_source TEXT,
  confidence_score REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  frozen BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_security_master_ticker_current
  ON public.security_master(ticker) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_security_master_isin
  ON public.security_master(isin) WHERE isin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_master_cusip
  ON public.security_master(cusip) WHERE cusip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_master_openfigi
  ON public.security_master(openfigi) WHERE openfigi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_master_company_name
  ON public.security_master(company_name) WHERE company_name IS NOT NULL;

ALTER TABLE public.security_master ENABLE ROW LEVEL SECURITY;

-- Only service_role can access. No policy for anon/authenticated = no access.
CREATE POLICY "security_master_service_role_only"
  ON public.security_master
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION update_security_master_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_security_master_updated_at
  BEFORE UPDATE ON public.security_master
  FOR EACH ROW EXECUTE FUNCTION update_security_master_updated_at();

COMMENT ON TABLE public.security_master IS
  'Internal security registry from ERM3. Contains ISIN, CUSIP, company_name. '
  'Service-role only - not exposed to public API. Use for Plaid resolution, admin tools.';
