-- Add subsector_etf column to symbols table (V3 category mapping)
-- Enables industry-level hedge ETF mapping (e.g., fs_industry_code -> XOP, XME, etc.)
-- Pipeline populates via FS_INDUSTRY_TO_SUBSECTOR_ETFS in etf_register

ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS subsector_etf TEXT;

COMMENT ON COLUMN public.symbols.subsector_etf IS
  'Subsector hedge mapping (e.g., XOP, XME). Derived from fs_industry_code via FS_INDUSTRY_TO_SUBSECTOR_ETFS. Fallback to sector_etf when unavailable.';
